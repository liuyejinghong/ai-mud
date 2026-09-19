// M14-B 协作调度（m14-p-contract.md §3 冻结语义；industry 唯一写者 cooperation_requests）。
// 必须在调用方事务内执行，本模块永不自开/提交事务；模型网络在事务外由 ai 网关的超时
// 保护承担（DECISION_TIMEOUT_MS + Promise.race），本模块只消费其 DecisionOutcomeDto。
//
// 【I 挂载说明】（base-settlement.service.ts 是 M12-B 文件，由 I 集成，本线不改）：
//  1. detect——在 BaseSettlementService.settleBase 内，saveStepUpdates / saveProjectUpdates /
//     robots.applyRobotUpdates 全部落盘之后调用（本 tick 步骤终态与机器人终态均已可见）：
//       const runningSteps = <本 tick 落盘后仍 status='running'、且该步骤上无同组 working
//         机器人的步骤>（CooperationDetectionStep：projectId + projectName(项目模板名) +
//         stepIndex + groupId=步骤所属组，由挂钩处从 stepUpdates/robotUpdates 终态计算）；
//       await detectAndResolveCooperation(tx, baseId, runningSteps, {
//         robots: this.deps.openRobots(tx),        // RobotRuntimeService 结构兼容（本文件端口）
//         gateway: <DecisionGateway 实例>,          // 结构兼容 CooperationDecisionPort
//         clock,                                    // 基地 tick 时钟（simTime 或墙钟，I 定）
//         baseRevision: <bases.base_revision>,      // DecisionRequestDto.planRevision
//         epoch: <基地纪元>,                        // DecisionRequestDto.epoch
//         openCooperation: (tx) => new CooperationRepository(tx)
//       });
//  2. apply——紧跟 detect 之后：await applyAcceptedHelpers(tx, baseId, { robots, openCooperation })
//     把 accepted helper 指向请求步骤并置 working（仅当它仍空闲）。
//  3. fulfilled——在项目 completion 处理循环（result.projectCompletions）内，对完成项目的每个
//     步骤调 new CooperationRepository(tx).markFulfilledByStep(tx, baseId, projectId, stepIndex)：
//     该步骤 pending/accepted 请求 → fulfilled；helper 回 idle 由 computeBaseTick 的完成释放
//     （按 projectId+stepIndex 释放，不分 组）负责。
//
// 【已知 seam（合同疑问，非本线文件）】industry.pure 的出工资格/补位/工作量归组均按
// groupId 严格相等判定：跨组 helper 在下一 tick 会被判“分配失效”转 idle，其工作量不计入。
// 让“跨组 working”真正持续出工需要 M12-B/I 在 pure 增加 helper 豁免（本线只落调度事实：
// 请求/决策审计/helper 指派），不绕过现有检查。
import { randomUUID } from "node:crypto";
import type {
  BaseRobotGroupId,
  DecisionRequestDto,
  DecisionOutcomeDto,
  RobotStatus
} from "@ai-mud/shared";
import { BASE_ROBOT_GROUPS, BASE_ROBOT_GROUP_NAMES, COOPERATION_TTL_MS, DECISION_TIMEOUT_MS } from "@ai-mud/shared";
import { ROBOT_WORK_DRAIN_WH } from "./industry.pure.js";
import type {
  CooperationRequestStore,
  CooperationTx
} from "./cooperation.repository.js";

// ---------- 结构端口（composition 绑定；不 import npc/ai 模块文件） ----------

// npc robot-runtime 读面（RobotOperatorRecord 结构一致；composition 按结构绑定）。
export interface CooperationOperatorRecord {
  operatorId: string;
  deviceId: string;
  deviceDefId: string;
  groupId: string;
  batteryWh: number;
  batteryCapacityWh: number;
  status: string;
  currentProjectId: string | null;
  currentStepIndex: number | null;
}

// npc robot-runtime 写面（RobotOperatorUpdate 结构一致；npc 仍是 robot_operators 唯一写者，
// 本模块经其结构端口写，不直连表）。
export interface CooperationRobotUpdate {
  operatorId: string;
  batteryWh: number;
  status: RobotStatus;
  currentProjectId: string | null;
  currentStepIndex: number | null;
}

export interface CooperationRobotPort {
  listOperators(baseId: string): Promise<CooperationOperatorRecord[]>;
  applyRobotUpdates(tx: CooperationTx, updates: CooperationRobotUpdate[]): Promise<void>;
}

// ai DecisionGateway 的结构子面（industry 不 import ai 模块文件，composition 绑定）。
export interface CooperationDecisionPort {
  decide(tx: CooperationTx, request: DecisionRequestDto): Promise<DecisionOutcomeDto>;
}

export interface CooperationClock {
  now(): Date;
}

// ---------- 输入/依赖 ----------

// 缺工步骤（调用方计算传入，签名约定）：本 tick 落盘后 status='running' 且该步骤上
// 无同组 working 机器人（currentProjectId=projectId && currentStepIndex=stepIndex &&
// status='working' && groupId=步骤组 的机器人数为 0）。
export interface CooperationDetectionStep {
  projectId: string;
  projectName: string;
  stepIndex: number;
  // fromGroup：步骤所属组（发出请求的一方）。
  groupId: BaseRobotGroupId;
}

export interface CooperationDeps {
  robots: CooperationRobotPort;
  gateway: CooperationDecisionPort;
  clock: CooperationClock;
  // DecisionRequestDto 上下文：planRevision 用 base_revision（bases 行），epoch 为基地纪元。
  baseRevision: number;
  epoch: number;
  // 生产绑定：(tx) => new CooperationRepository(tx)
  openCooperation: (tx: CooperationTx) => CooperationRequestStore;
}

export interface CooperationResolutionResult {
  requestsCreated: number;
  decisionsRequested: number;
  helpersAccepted: number;
  expired: number;
}

// ---------- 缺工检测 + 决策 + 接受（合同 §3.1/§3.2） ----------

export async function detectAndResolveCooperation(
  tx: CooperationTx,
  baseId: string,
  runningSteps: CooperationDetectionStep[],
  deps: CooperationDeps
): Promise<CooperationResolutionResult> {
  const repo = deps.openCooperation(tx);
  const operators = await deps.robots.listOperators(baseId);
  const now = deps.clock.now();
  const result: CooperationResolutionResult = {
    requestsCreated: 0,
    decisionsRequested: 0,
    helpersAccepted: 0,
    expired: 0
  };

  const seenSteps = new Set<string>();
  for (const step of runningSteps) {
    const stepKey = `${step.projectId}:${step.stepIndex}`;
    if (seenSteps.has(stepKey)) continue; // 同步骤重复输入只处理一次
    seenSteps.add(stepKey);

    // 候选（合同 §3.1）：其他组 + idle + battery ≥ ROBOT_WORK_DRAIN_WH，score = 电量比例；
    // 排序确定（分数降序、operatorId 升序），同输入同候选序。
    const candidates = operators
      .filter(
        (operator) =>
          operator.groupId !== step.groupId &&
          operator.status === "idle" &&
          operator.batteryWh >= ROBOT_WORK_DRAIN_WH &&
          operator.batteryCapacityWh > 0
      )
      .map((operator) => ({
        operatorId: operator.operatorId,
        groupId: operator.groupId,
        batteryWh: operator.batteryWh,
        batteryCapacityWh: operator.batteryCapacityWh,
        score: operator.batteryWh / operator.batteryCapacityWh
      }))
      .sort((a, b) =>
        b.score !== a.score ? b.score - a.score : a.operatorId < b.operatorId ? -1 : 1
      );

    const question = cooperationQuestion(step);

    let request = await repo.findPendingByStep(tx, baseId, step.projectId, step.stepIndex);
    if (!request) {
      // helperGroupId：有候选取最高分候选的组；无候选回退与请求组不同的首个固定组
      // （列 notNull 占位，abstain 期间无 helper 语义）。
      const helperGroupId = candidates[0]?.groupId ?? fallbackHelperGroupId(step.groupId);
      const created = await repo.create(tx, {
        baseId,
        projectId: step.projectId,
        stepIndex: step.stepIndex,
        fromGroupId: step.groupId,
        helperGroupId,
        question,
        createdAt: now
      });
      result.requestsCreated += 1;
      request = {
        requestId: created.requestId,
        baseId,
        projectId: step.projectId,
        stepIndex: step.stepIndex,
        fromGroupId: step.groupId,
        helperGroupId,
        status: "pending",
        helperOperatorId: null,
        decisionId: null,
        question,
        createdAt: now,
        resolvedAt: null
      };
    }

    // 无候选 abstain：不写决策记录（本次没有可选项），请求保持 pending 等待下次 tick
    // 出现候选再决策（合同 §3.2“无候选 abstain→请求保持 pending 等待下次 tick”）。
    if (candidates.length === 0) continue;

    const decisionId = randomUUID();
    const outcome = await deps.gateway.decide(tx, {
      decisionId,
      purpose: "transport_assistance",
      baseId,
      epoch: deps.epoch,
      planRevision: deps.baseRevision,
      question,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.operatorId,
        summary: `${groupLabel(candidate.groupId)}机器人 电量 ${candidate.batteryWh}/${candidate.batteryCapacityWh}Wh`,
        score: candidate.score
      })),
      deadlineMs: DECISION_TIMEOUT_MS
    });
    result.decisionsRequested += 1;

    // 决策只选 ID（合同 §1）：selected → accepted + helper_operator_id；abstain → 保持 pending。
    if (outcome.selectedCandidateId !== null) {
      await repo.accept(tx, request.requestId, outcome.selectedCandidateId, decisionId);
      result.helpersAccepted += 1;
    }
  }

  // TTL（合同 §3.2）：pending 超过 COOPERATION_TTL_MS → expired（含步骤已不缺工但未决的
  // 历史请求；fulfilled/accepted/declined 不受影响）。
  const requests = await repo.listByBase(tx, baseId);
  for (const request of requests) {
    if (request.status !== "pending") continue;
    if (now.getTime() - request.createdAt.getTime() > COOPERATION_TTL_MS) {
      await repo.expire(tx, request.requestId);
      result.expired += 1;
    }
  }

  return result;
}

// ---------- accepted helper 出工（合同 §3.3 前半：临时接入该步骤作业） ----------

// 把 accepted 请求的 helper operator 指向请求步骤并置 working——仅当它仍空闲
// （已被常规分配/充电/离线的 helper 不覆盖，请求保持 accepted 由后续 tick 再试）。
// 返回实际接入的 helper 数。
export async function applyAcceptedHelpers(
  tx: CooperationTx,
  baseId: string,
  deps: Pick<CooperationDeps, "robots" | "openCooperation">
): Promise<number> {
  const repo = deps.openCooperation(tx);
  const accepted = (await repo.listByBase(tx, baseId)).filter(
    (request) => request.status === "accepted"
  );
  if (accepted.length === 0) return 0;

  const operators = await deps.robots.listOperators(baseId);
  const operatorById = new Map(operators.map((operator) => [operator.operatorId, operator]));

  const updates: CooperationRobotUpdate[] = [];
  for (const request of accepted) {
    if (!request.helperOperatorId) continue;
    const helper = operatorById.get(request.helperOperatorId);
    if (!helper || helper.status !== "idle") continue;
    updates.push({
      operatorId: helper.operatorId,
      batteryWh: helper.batteryWh,
      status: "working",
      currentProjectId: request.projectId,
      currentStepIndex: request.stepIndex
    });
  }
  if (updates.length > 0) await deps.robots.applyRobotUpdates(tx, updates);
  return updates.length;
}

// ---------- 文案与小组工具 ----------

function groupLabel(groupId: string): string {
  return BASE_ROBOT_GROUP_NAMES[groupId as BaseRobotGroupId] ?? groupId;
}

function cooperationQuestion(step: CooperationDetectionStep): string {
  return `${step.projectName}第 ${step.stepIndex + 1} 步缺少可出工的${groupLabel(step.groupId)}机器人，请求跨组支援。`;
}

function fallbackHelperGroupId(fromGroupId: BaseRobotGroupId): BaseRobotGroupId {
  const fallback = BASE_ROBOT_GROUPS.find((group) => group !== fromGroupId);
  return fallback ?? "transport";
}
