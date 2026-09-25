// M14-B 协作调度：调用方事务内读写请求与机器人；步骤完成由结算逐步结案。
// B005 生命周期：打开的请求（pending/accepted）所指步骤不再可能推进时必须结案，helper 随之释放：
//   项目 cancelled → project_cancelled（取消命令同事务结案，见 construction.service；这里兜底竞态/旧存档）
//   项目 failed → project_failed；步骤 failed → step_failed；步骤 blocked content_missing → content_missing
//   项目/步骤 completed → fulfilled（结算钩子的兜底）
//   步骤 blocked insufficient_power → 保持（可恢复：helper 原地充电，复电后回原步骤，C07）
// 每次缺工检测前先按上表回收（≤1 个结算 tick），被释放的 helper 同一 tick 即可再次入选候选。
import { randomUUID } from "node:crypto";
import type {
  BaseRobotGroupId,
  DecisionRequestDto,
  DecisionOutcomeDto,
  RobotStatus
} from "@ai-mud/shared";
import { BASE_ROBOT_GROUPS, BASE_ROBOT_GROUP_NAMES, COOPERATION_TTL_MS, DECISION_TIMEOUT_MS } from "@ai-mud/shared";
import { CONTENT_BLOCK_REASON, ROBOT_WORK_DRAIN_WH } from "./industry.pure.js";
import type {
  CooperationCloseReason,
  CooperationRequestRecord,
  CooperationRequestStore,
  CooperationStepState,
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

// 调用方只传 ready/running 且本组无可出工机器人的步骤。
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
  // 本次落 expired 的请求数：pending TTL 过期 + B005 非完成结案（两者持久化状态相同）。
  expired: number;
}

// ---------- B005 结案/回收规则（纯函数） ----------

export type CooperationStepOutcome = "fulfilled" | CooperationCloseReason;

// 返回 null 表示步骤仍可推进或可恢复，请求保持打开。
export function cooperationStepOutcome(state: {
  projectStatus: string;
  stepStatus: string | null;
  blockedReason: string | null;
}): CooperationStepOutcome | null {
  if (state.projectStatus === "completed") return "fulfilled";
  if (state.projectStatus === "cancelled") return "project_cancelled";
  if (state.projectStatus === "failed") return "project_failed";
  if (state.stepStatus === "completed") return "fulfilled";
  if (state.stepStatus === "failed") return "step_failed";
  if (state.stepStatus === "blocked" && state.blockedReason === CONTENT_BLOCK_REASON) {
    return "content_missing";
  }
  return null;
}

function isOpenRequest(request: CooperationRequestRecord): boolean {
  return request.status === "pending" || request.status === "accepted";
}

function stepKeyOf(projectId: string, stepIndex: number): string {
  return `${projectId}:${stepIndex}`;
}

interface LifecycleReconciliation {
  closedRequestIds: Set<string>;
  expired: number;
  operators: CooperationOperatorRecord[];
}

// 按 cooperationStepOutcome 结案打开的请求，并把仍挂在“已不可推进步骤”上的 helper 释放为 idle。
// working 的 helper 已由纯规则在本 tick 回收；这里处理的是缺电阻塞时原地 charging、之后项目被
// 取消/内容失效的 helper（纯规则只回收 working，charging 会一直挂着旧分配而进不了候选）。
async function reconcileRequestLifecycle(
  tx: CooperationTx,
  baseId: string,
  repo: CooperationRequestStore,
  requests: CooperationRequestRecord[],
  operators: CooperationOperatorRecord[],
  robots: CooperationRobotPort
): Promise<LifecycleReconciliation> {
  const reconciliation: LifecycleReconciliation = { closedRequestIds: new Set(), expired: 0, operators };
  const operatorById = new Map(operators.map((operator) => [operator.operatorId, operator]));
  const open = requests.filter(isOpenRequest);
  const helperStillAssigned = requests.filter((request) => {
    if (!request.helperOperatorId) return false;
    const helper = operatorById.get(request.helperOperatorId);
    return helper !== undefined &&
      (helper.status === "working" || helper.status === "charging") &&
      helper.currentProjectId === request.projectId &&
      helper.currentStepIndex === request.stepIndex;
  });
  const projectIds = [...new Set([...open, ...helperStillAssigned].map((request) => request.projectId))];
  if (projectIds.length === 0) return reconciliation;

  const states = await repo.listStepStates(tx, baseId, projectIds);
  const projectStatusById = new Map<string, string>();
  const stepStateByKey = new Map<string, CooperationStepState>();
  for (const state of states) {
    projectStatusById.set(state.projectId, state.projectStatus);
    if (state.stepIndex !== null) stepStateByKey.set(stepKeyOf(state.projectId, state.stepIndex), state);
  }
  const outcomeOf = (request: CooperationRequestRecord): CooperationStepOutcome | null => {
    const projectStatus = projectStatusById.get(request.projectId);
    if (projectStatus === undefined) return null; // 查无项目：不猜测，保持原状
    const step = stepStateByKey.get(stepKeyOf(request.projectId, request.stepIndex));
    return cooperationStepOutcome({
      projectStatus,
      stepStatus: step?.stepStatus ?? null,
      blockedReason: step?.blockedReason ?? null
    });
  };

  const fulfilledSteps = new Set<string>();
  for (const request of open) {
    const outcome = outcomeOf(request);
    if (outcome === null) continue;
    if (outcome === "fulfilled") {
      const key = stepKeyOf(request.projectId, request.stepIndex);
      if (!fulfilledSteps.has(key)) {
        await repo.markFulfilledByStep(tx, baseId, request.projectId, request.stepIndex);
        fulfilledSteps.add(key);
      }
      reconciliation.closedRequestIds.add(request.requestId);
      continue;
    }
    if (await repo.closeOpen(tx, request.requestId, outcome)) {
      reconciliation.closedRequestIds.add(request.requestId);
      reconciliation.expired += 1;
    }
  }

  const releases = new Map<string, CooperationRobotUpdate>();
  for (const request of helperStillAssigned) {
    if (outcomeOf(request) === null) continue; // 步骤仍可推进/可恢复：不动 helper
    const helper = operatorById.get(request.helperOperatorId as string);
    if (!helper || releases.has(helper.operatorId)) continue;
    releases.set(helper.operatorId, {
      operatorId: helper.operatorId,
      batteryWh: helper.batteryWh,
      status: "idle",
      currentProjectId: null,
      currentStepIndex: null
    });
  }
  if (releases.size > 0) {
    await robots.applyRobotUpdates(tx, [...releases.values()]);
    reconciliation.operators = operators.map((operator) => {
      const release = releases.get(operator.operatorId);
      return release
        ? { ...operator, status: release.status, currentProjectId: null, currentStepIndex: null }
        : operator;
    });
  }
  return reconciliation;
}

// ---------- 缺工检测 + 决策 + 接受（合同 §3.1/§3.2） ----------

export async function detectAndResolveCooperation(
  tx: CooperationTx,
  baseId: string,
  needySteps: CooperationDetectionStep[],
  deps: CooperationDeps
): Promise<CooperationResolutionResult> {
  const repo = deps.openCooperation(tx);
  const now = deps.clock.now();
  const result: CooperationResolutionResult = {
    requestsCreated: 0,
    decisionsRequested: 0,
    helpersAccepted: 0,
    expired: 0
  };
  const existing = await repo.listByBase(tx, baseId);
  // B005：先结案所指步骤已不可推进的请求、释放其 helper，再算候选与占用。
  const lifecycle = await reconcileRequestLifecycle(
    tx,
    baseId,
    repo,
    existing,
    await deps.robots.listOperators(baseId),
    deps.robots
  );
  const operators = lifecycle.operators;
  result.expired += lifecycle.expired;
  // 仍打开的已接受 helper 和本次新接受的 helper 都不能再分给其他步骤。
  const reservedHelpers = new Set(
    existing.flatMap((request) =>
      request.status === "accepted" &&
      request.helperOperatorId &&
      !lifecycle.closedRequestIds.has(request.requestId)
        ? [request.helperOperatorId]
        : []
    )
  );

  const seenSteps = new Set<string>();
  for (const step of needySteps) {
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
          !reservedHelpers.has(operator.operatorId) &&
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

    let request = await repo.findOpenByStep(tx, baseId, step.projectId, step.stepIndex);
    if (request?.status === "accepted") continue;
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
    // 条件接受：请求若已被并发结案（如取消项目），不复活、不占用 helper。
    if (
      outcome.selectedCandidateId !== null &&
      (await repo.accept(tx, request.requestId, outcome.selectedCandidateId, decisionId))
    ) {
      reservedHelpers.add(outcome.selectedCandidateId);
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

// 把 accepted helper 指向仍可推进的请求步骤；复电后原地充电的 helper 可重新出工。
// 已被其他任务占用或电量不足时，请求保持 accepted，后续 tick 再试。
// 返回实际接入的 helper 数。
export async function applyAcceptedHelpers(
  tx: CooperationTx,
  baseId: string,
  runnableSteps: Array<{ projectId: string; stepIndex: number }>,
  deps: Pick<CooperationDeps, "robots" | "openCooperation">
): Promise<number> {
  const repo = deps.openCooperation(tx);
  const accepted = (await repo.listByBase(tx, baseId)).filter(
    (request) => request.status === "accepted"
  );
  if (accepted.length === 0) return 0;

  const operators = await deps.robots.listOperators(baseId);
  const operatorById = new Map(operators.map((operator) => [operator.operatorId, operator]));
  const runnable = new Set(runnableSteps.map((step) => `${step.projectId}:${step.stepIndex}`));

  const updates: CooperationRobotUpdate[] = [];
  const claimed = new Set<string>();
  for (const request of accepted) {
    if (!request.helperOperatorId) continue;
    if (!runnable.has(`${request.projectId}:${request.stepIndex}`)) continue;
    const helper = operatorById.get(request.helperOperatorId);
    if (!helper || helper.batteryWh < ROBOT_WORK_DRAIN_WH || claimed.has(helper.operatorId)) continue;
    if (helper.status !== "idle" && !(
      helper.status === "charging" &&
      helper.currentProjectId === request.projectId &&
      helper.currentStepIndex === request.stepIndex
    )) continue;
    claimed.add(helper.operatorId);
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
