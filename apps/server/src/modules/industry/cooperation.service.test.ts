// M14-B 协作调度测试（全部内存假体：仓库/机器人端口/决策网关/固定时钟）。
import { describe, expect, it } from "vitest";
import type { DecisionRequestDto, DecisionOutcomeDto } from "@ai-mud/shared";
import { COOPERATION_TTL_MS } from "@ai-mud/shared";
import {
  closedStatusFor,
  type CooperationCloseReason,
  type CooperationRequestRecord,
  type CooperationRequestStore,
  type CooperationStepState,
  type CooperationTx,
  type CreateCooperationRequestInput
} from "./cooperation.repository.js";
import {
  applyAcceptedHelpers,
  cooperationStepOutcome,
  detectAndResolveCooperation,
  type CooperationDetectionStep,
  type CooperationDeps,
  type CooperationOperatorRecord,
  type CooperationRobotUpdate
} from "./cooperation.service.js";

const T0 = new Date("2026-09-19T08:00:00.000Z");
const BASE_ID = "base-1";

class InMemoryCooperationRepo implements CooperationRequestStore {
  records: CooperationRequestRecord[] = [];
  // 项目/步骤事实（真库由 base_projects × base_project_steps 读出）；默认空 = 状态未知，不结案。
  stepStates: CooperationStepState[] = [];
  closeReasons = new Map<string, CooperationCloseReason>();
  private seq = 0;

  async create(_tx: CooperationTx, input: CreateCooperationRequestInput) {
    this.seq += 1;
    const record: CooperationRequestRecord = {
      requestId: `req-${this.seq}`,
      baseId: input.baseId,
      projectId: input.projectId,
      stepIndex: input.stepIndex,
      fromGroupId: input.fromGroupId,
      helperGroupId: input.helperGroupId,
      status: "pending",
      helperOperatorId: null,
      decisionId: null,
      question: input.question,
      createdAt: input.createdAt,
      resolvedAt: null
    };
    this.records.push(record);
    return { requestId: record.requestId };
  }

  async listByBase(_tx: CooperationTx, baseId: string) {
    return this.records
      .filter((record) => record.baseId === baseId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findOpenByStep(
    _tx: CooperationTx,
    baseId: string,
    projectId: string,
    stepIndex: number
  ) {
    return (
      [...this.records].sort((a, b) => a.status.localeCompare(b.status)).find(
        (record) =>
          record.baseId === baseId &&
          record.projectId === projectId &&
          record.stepIndex === stepIndex &&
          (record.status === "pending" || record.status === "accepted")
      ) ?? null
    );
  }

  // 与真库同语义：只有仍 pending 的请求能被接受（并发结案的请求不复活）。
  async accept(_tx: CooperationTx, requestId: string, helperOperatorId: string, decisionId: string) {
    const record = this.records.find((entry) => entry.requestId === requestId);
    if (!record || record.status !== "pending") return false;
    record.status = "accepted";
    record.helperOperatorId = helperOperatorId;
    record.decisionId = decisionId;
    return true;
  }

  async expire(_tx: CooperationTx, requestId: string) {
    this.mutate(requestId, (record) => {
      if (record.status !== "pending") return;
      record.status = "expired";
      record.resolvedAt = T0;
    });
  }

  async closeOpen(_tx: CooperationTx, requestId: string, reason: CooperationCloseReason) {
    const record = this.records.find((entry) => entry.requestId === requestId);
    if (!record || (record.status !== "pending" && record.status !== "accepted")) return false;
    record.status = closedStatusFor(reason);
    record.resolvedAt = T0;
    this.closeReasons.set(requestId, reason);
    return true;
  }

  async closeOpenByProject(
    tx: CooperationTx,
    baseId: string,
    projectId: string,
    reason: CooperationCloseReason
  ) {
    let closed = 0;
    for (const record of this.records) {
      if (record.baseId !== baseId || record.projectId !== projectId) continue;
      if (await this.closeOpen(tx, record.requestId, reason)) closed += 1;
    }
    return closed;
  }

  async listStepStates(_tx: CooperationTx, _baseId: string, projectIds: string[]) {
    return this.stepStates.filter((state) => projectIds.includes(state.projectId));
  }

  async markFulfilled(_tx: CooperationTx, requestId: string) {
    this.mutate(requestId, (record) => {
      record.status = "fulfilled";
      record.resolvedAt = T0;
    });
  }

  async markFulfilledByStep(
    _tx: CooperationTx,
    baseId: string,
    projectId: string,
    stepIndex: number
  ) {
    for (const record of this.records) {
      if (
        record.baseId === baseId &&
        record.projectId === projectId &&
        record.stepIndex === stepIndex &&
        (record.status === "pending" || record.status === "accepted")
      ) {
        record.status = "fulfilled";
        record.resolvedAt = T0;
      }
    }
  }

  private mutate(requestId: string, fn: (record: CooperationRequestRecord) => void) {
    const record = this.records.find((entry) => entry.requestId === requestId);
    if (record) fn(record);
  }
}

class FakeRobots {
  operators: CooperationOperatorRecord[] = [];
  applied: CooperationRobotUpdate[] = [];

  async listOperators(_baseId: string) {
    return this.operators;
  }

  async applyRobotUpdates(_tx: CooperationTx, updates: CooperationRobotUpdate[]) {
    this.applied.push(...updates);
    for (const update of updates) {
      const operator = this.operators.find((entry) => entry.operatorId === update.operatorId);
      if (!operator) continue;
      operator.batteryWh = update.batteryWh;
      operator.status = update.status;
      operator.currentProjectId = update.currentProjectId;
      operator.currentStepIndex = update.currentStepIndex;
    }
  }
}

class FakeGateway {
  requests: DecisionRequestDto[] = [];
  selectedCandidateId: string | null = null;

  async decide(_tx: CooperationTx, request: DecisionRequestDto): Promise<DecisionOutcomeDto> {
    this.requests.push(request);
    return {
      decisionId: request.decisionId,
      selectedCandidateId: this.selectedCandidateId,
      mode: "rule",
      provider: "rule",
      latencyMs: 1,
      reason: "测试决策"
    };
  }
}

function makeRobot(overrides: Partial<CooperationOperatorRecord> = {}): CooperationOperatorRecord {
  return {
    operatorId: "op-t1",
    deviceId: "dev-1",
    deviceDefId: "yd-t1",
    groupId: "transport",
    batteryWh: 9000,
    batteryCapacityWh: 10000,
    status: "idle",
    currentProjectId: null,
    currentStepIndex: null,
    ...overrides
  };
}

const STEP: CooperationDetectionStep = {
  projectId: "p1",
  projectName: "架设光伏阵列",
  stepIndex: 0,
  groupId: "engineering"
};

function makeHarness() {
  const repo = new InMemoryCooperationRepo();
  const robots = new FakeRobots();
  const gateway = new FakeGateway();
  const deps: CooperationDeps = {
    robots,
    gateway,
    clock: { now: () => T0 },
    baseRevision: 3,
    epoch: 1,
    openCooperation: () => repo
  };
  const tx = {} as CooperationTx;
  return { repo, robots, gateway, deps, tx };
}

describe("detectAndResolveCooperation", () => {
  it("缺工步骤创建 pending 请求并决策接受：绑定 helper_operator_id 与 decision_id", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    robots.operators = [makeRobot()];
    gateway.selectedCandidateId = "op-t1";

    const result = await detectAndResolveCooperation(tx, BASE_ID, [STEP], deps);

    expect(result).toEqual({
      requestsCreated: 1,
      decisionsRequested: 1,
      helpersAccepted: 1,
      expired: 0
    });
    const request = repo.records[0];
    expect(request).toMatchObject({
      baseId: BASE_ID,
      projectId: "p1",
      stepIndex: 0,
      fromGroupId: "engineering",
      helperGroupId: "transport",
      status: "accepted",
      helperOperatorId: "op-t1"
    });
    expect(request?.question).toBe("架设光伏阵列第 1 步缺少可出工的工程维护组机器人，请求跨组支援。");
    expect(request?.decisionId).toBe(gateway.requests[0]?.decisionId);
  });

  it("同步骤已有 pending：不重复创建，仅对既有请求再决策", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    robots.operators = [makeRobot()];
    gateway.selectedCandidateId = "op-t1";
    repo.records.push({
      requestId: "req-existing",
      baseId: BASE_ID,
      projectId: "p1",
      stepIndex: 0,
      fromGroupId: "engineering",
      helperGroupId: "transport",
      status: "pending",
      helperOperatorId: null,
      decisionId: null,
      question: "旧请求",
      createdAt: new Date(T0.getTime() - 1000),
      resolvedAt: null
    });

    const result = await detectAndResolveCooperation(tx, BASE_ID, [STEP], deps);

    expect(result.requestsCreated).toBe(0);
    expect(result.decisionsRequested).toBe(1);
    expect(repo.records).toHaveLength(1);
    expect(repo.records[0]?.requestId).toBe("req-existing");
    expect(repo.records[0]?.status).toBe("accepted");
  });

  it("同步骤已有 accepted：不重复创建或再次决策", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    robots.operators = [makeRobot()];
    repo.records.push({
      requestId: "req-accepted", baseId: BASE_ID, projectId: "p1", stepIndex: 0,
      fromGroupId: "engineering", helperGroupId: "transport", status: "accepted",
      helperOperatorId: "op-t1", decisionId: "decision-1", question: "已有支援",
      createdAt: T0, resolvedAt: null
    });

    const result = await detectAndResolveCooperation(tx, BASE_ID, [STEP], deps);

    expect(result).toEqual({ requestsCreated: 0, decisionsRequested: 0, helpersAccepted: 0, expired: 0 });
    expect(repo.records).toHaveLength(1);
    expect(gateway.requests).toHaveLength(0);
  });

  it("同 tick 多个缺工步骤不会同时占用同一 helper", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    robots.operators = [makeRobot()];
    gateway.selectedCandidateId = "op-t1";

    await detectAndResolveCooperation(tx, BASE_ID, [STEP, { ...STEP, stepIndex: 1, groupId: "survey" }], deps);

    expect(repo.records.map((request) => request.status)).toEqual(["accepted", "pending"]);
    expect(gateway.requests).toHaveLength(1);
  });

  it("决策弃权：请求保持 pending，不绑定 helper", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    robots.operators = [makeRobot()];
    gateway.selectedCandidateId = null;

    const result = await detectAndResolveCooperation(tx, BASE_ID, [STEP], deps);

    expect(result.helpersAccepted).toBe(0);
    expect(result.decisionsRequested).toBe(1);
    expect(repo.records[0]).toMatchObject({ status: "pending", helperOperatorId: null });
  });

  it("无候选（无其他组空闲机器人）：不抛、创建 pending 但不请求决策，等待下次 tick", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    robots.operators = [
      makeRobot({ status: "working", currentProjectId: "p0", currentStepIndex: 0 }),
      makeRobot({ operatorId: "op-t2", groupId: "engineering" }) // 同组空闲不算候选
    ];

    const result = await detectAndResolveCooperation(tx, BASE_ID, [STEP], deps);

    expect(result).toEqual({
      requestsCreated: 1,
      decisionsRequested: 0,
      helpersAccepted: 0,
      expired: 0
    });
    expect(gateway.requests).toHaveLength(0);
    expect(repo.records[0]).toMatchObject({ status: "pending", helperGroupId: "transport" });
  });

  it("候选过滤：同组、低电量、非 idle 的机器人都不进候选；score 为电量比例", async () => {
    const { robots, gateway, deps, tx } = makeHarness();
    robots.operators = [
      makeRobot({ operatorId: "op-low", batteryWh: 400 }), // < ROBOT_WORK_DRAIN_WH
      makeRobot({ operatorId: "op-busy", status: "charging" }),
      makeRobot({ operatorId: "op-same", groupId: "engineering" }),
      makeRobot({ operatorId: "op-b", batteryWh: 8000 }),
      makeRobot({ operatorId: "op-a", batteryWh: 8000 }) // 与 op-b 并列，operatorId 升序在前
    ];

    await detectAndResolveCooperation(tx, BASE_ID, [STEP], deps);

    expect(gateway.requests[0]?.candidates).toEqual([
      { candidateId: "op-a", summary: "资源运输组机器人 电量 8000/10000Wh", score: 0.8 },
      { candidateId: "op-b", summary: "资源运输组机器人 电量 8000/10000Wh", score: 0.8 }
    ]);
    expect(gateway.requests[0]).toMatchObject({
      purpose: "transport_assistance",
      baseId: BASE_ID,
      epoch: 1,
      planRevision: 3,
      deadlineMs: 2000
    });
  });

  it("pending 超过 COOPERATION_TTL_MS → expired；本 tick 新建的 pending 不受影响", async () => {
    const { repo, robots, deps, tx } = makeHarness();
    robots.operators = []; // 无候选路径，避免干扰
    repo.records.push({
      requestId: "req-old",
      baseId: BASE_ID,
      projectId: "p0",
      stepIndex: 2,
      fromGroupId: "engineering",
      helperGroupId: "transport",
      status: "pending",
      helperOperatorId: null,
      decisionId: null,
      question: "过期请求",
      createdAt: new Date(T0.getTime() - COOPERATION_TTL_MS - 1),
      resolvedAt: null
    });

    const result = await detectAndResolveCooperation(tx, BASE_ID, [STEP], deps);

    expect(result.expired).toBe(1);
    expect(repo.records.find((record) => record.requestId === "req-old")?.status).toBe("expired");
    expect(repo.records.find((record) => record.requestId === "req-1")?.status).toBe("pending");
  });

  it("无 runningSteps 与无机器人：不抛且零写入", async () => {
    const { repo, robots, deps, tx } = makeHarness();
    robots.operators = [];

    const result = await detectAndResolveCooperation(tx, BASE_ID, [], deps);

    expect(result).toEqual({
      requestsCreated: 0,
      decisionsRequested: 0,
      helpersAccepted: 0,
      expired: 0
    });
    expect(repo.records).toHaveLength(0);
  });
});

describe("applyAcceptedHelpers", () => {
  it("accepted 请求：空闲 helper 被置 working 并指向请求步骤（电量原样透传）", async () => {
    const { repo, robots, deps, tx } = makeHarness();
    robots.operators = [makeRobot()];
    repo.records.push({
      requestId: "req-1",
      baseId: BASE_ID,
      projectId: "p1",
      stepIndex: 0,
      fromGroupId: "engineering",
      helperGroupId: "transport",
      status: "accepted",
      helperOperatorId: "op-t1",
      decisionId: "decision-1",
      question: "支援请求",
      createdAt: T0,
      resolvedAt: null
    });

    const applied = await applyAcceptedHelpers(tx, BASE_ID, [STEP], deps);

    expect(applied).toBe(1);
    expect(robots.operators[0]).toMatchObject({
      status: "working",
      currentProjectId: "p1",
      currentStepIndex: 0,
      batteryWh: 9000
    });
  });

  it("helper 已不空闲（被常规分配）：不接入，返回 0", async () => {
    const { repo, robots, deps, tx } = makeHarness();
    robots.operators = [
      makeRobot({ status: "working", currentProjectId: "p9", currentStepIndex: 1 })
    ];
    repo.records.push({
      requestId: "req-1",
      baseId: BASE_ID,
      projectId: "p1",
      stepIndex: 0,
      fromGroupId: "engineering",
      helperGroupId: "transport",
      status: "accepted",
      helperOperatorId: "op-t1",
      decisionId: "decision-1",
      question: "支援请求",
      createdAt: T0,
      resolvedAt: null
    });

    const applied = await applyAcceptedHelpers(tx, BASE_ID, [STEP], deps);

    expect(applied).toBe(0);
    expect(robots.applied).toHaveLength(0);
    expect(robots.operators[0]).toMatchObject({ currentProjectId: "p9", currentStepIndex: 1 });
  });

  it("充电中的 helper 仅在原步骤可推进时复工", async () => {
    const { repo, robots, deps, tx } = makeHarness();
    robots.operators = [makeRobot({
      status: "charging", currentProjectId: "p1", currentStepIndex: 0
    })];
    repo.records.push({
      requestId: "req-1", baseId: BASE_ID, projectId: "p1", stepIndex: 0,
      fromGroupId: "engineering", helperGroupId: "transport", status: "accepted",
      helperOperatorId: "op-t1", decisionId: "decision-1", question: "支援请求",
      createdAt: T0, resolvedAt: null
    });

    expect(await applyAcceptedHelpers(tx, BASE_ID, [], deps)).toBe(0);
    robots.operators[0]!.currentProjectId = "p9";
    expect(await applyAcceptedHelpers(tx, BASE_ID, [STEP], deps)).toBe(0);
    robots.operators[0]!.currentProjectId = "p1";
    expect(await applyAcceptedHelpers(tx, BASE_ID, [STEP], deps)).toBe(1);
    expect(robots.operators[0]).toMatchObject({
      status: "working", currentProjectId: "p1", currentStepIndex: 0
    });
  });
});

describe("markFulfilledByStep", () => {
  it("步骤完成：该步骤 pending/accepted 请求全部 fulfilled，expired 不动", async () => {
    const { repo, deps, tx } = makeHarness();
    repo.records.push(
      {
        requestId: "req-accepted",
        baseId: BASE_ID,
        projectId: "p1",
        stepIndex: 0,
        fromGroupId: "engineering",
        helperGroupId: "transport",
        status: "accepted",
        helperOperatorId: "op-t1",
        decisionId: "decision-1",
        question: "支援请求",
        createdAt: T0,
        resolvedAt: null
      },
      {
        requestId: "req-stale-pending",
        baseId: BASE_ID,
        projectId: "p1",
        stepIndex: 0,
        fromGroupId: "engineering",
        helperGroupId: "transport",
        status: "pending",
        helperOperatorId: null,
        decisionId: null,
        question: "旧请求",
        createdAt: T0,
        resolvedAt: null
      },
      {
        requestId: "req-expired",
        baseId: BASE_ID,
        projectId: "p1",
        stepIndex: 0,
        fromGroupId: "engineering",
        helperGroupId: "transport",
        status: "expired",
        helperOperatorId: null,
        decisionId: null,
        question: "已过期",
        createdAt: T0,
        resolvedAt: T0
      }
    );

    await deps.openCooperation(tx).markFulfilledByStep(tx, BASE_ID, "p1", 0);

    expect(repo.records.map((record) => record.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "expired"
    ]);
  });
});

// ---------- B005：协作请求生命周期结案（项目取消 / 内容缺失 / 失败；缺电保持） ----------

function openRequest(overrides: Partial<CooperationRequestRecord> = {}): CooperationRequestRecord {
  return {
    requestId: "req-a",
    baseId: BASE_ID,
    projectId: "p1",
    stepIndex: 0,
    fromGroupId: "engineering",
    helperGroupId: "transport",
    status: "accepted",
    helperOperatorId: "op-t1",
    decisionId: "decision-1",
    question: "支援请求",
    createdAt: T0,
    resolvedAt: null,
    ...overrides
  };
}

function stepState(overrides: Partial<CooperationStepState> = {}): CooperationStepState {
  return {
    projectId: "p1",
    projectStatus: "active",
    stepIndex: 0,
    stepStatus: "running",
    blockedReason: null,
    ...overrides
  };
}

const OTHER_STEP: CooperationDetectionStep = {
  projectId: "p2",
  projectName: "架设第二太阳电池阵",
  stepIndex: 0,
  groupId: "engineering"
};

describe("cooperationStepOutcome（B005 结案/回收规则）", () => {
  it.each([
    [{ projectStatus: "cancelled", stepStatus: "running", blockedReason: null }, "project_cancelled"],
    [{ projectStatus: "cancelled", stepStatus: null, blockedReason: null }, "project_cancelled"],
    [{ projectStatus: "failed", stepStatus: "ready", blockedReason: null }, "project_failed"],
    [{ projectStatus: "active", stepStatus: "failed", blockedReason: null }, "step_failed"],
    [{ projectStatus: "active", stepStatus: "blocked", blockedReason: "content_missing" }, "content_missing"],
    [{ projectStatus: "completed", stepStatus: "running", blockedReason: null }, "fulfilled"],
    [{ projectStatus: "active", stepStatus: "completed", blockedReason: null }, "fulfilled"]
  ] as const)("%j → %s", (state, outcome) => {
    expect(cooperationStepOutcome(state)).toBe(outcome);
  });

  it.each([
    { projectStatus: "active", stepStatus: "ready", blockedReason: null },
    { projectStatus: "active", stepStatus: "running", blockedReason: null },
    { projectStatus: "active", stepStatus: "pending", blockedReason: null },
    // 缺电阻塞是可恢复状态：保持 accepted，helper 原地充电、复电后回原步骤（C07）。
    { projectStatus: "active", stepStatus: "blocked", blockedReason: "insufficient_power" }
  ])("仍可推进或可恢复的步骤不结案：%j", (state) => {
    expect(cooperationStepOutcome(state)).toBeNull();
  });

  it("现有状态机下所有非完成结案都落 expired（请求已失效），原因由调用方显式给出", () => {
    for (const reason of ["project_cancelled", "project_failed", "step_failed", "content_missing"] as const) {
      expect(closedStatusFor(reason)).toBe("expired");
    }
  });
});

describe("detectAndResolveCooperation > B005 生命周期回收", () => {
  it("已取消项目上仍打开的请求：结案 project_cancelled，释放仍指向该步骤的 helper，同 tick 可再被选为候选", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    repo.records.push(
      openRequest(),
      openRequest({
        requestId: "req-p", stepIndex: 1, status: "pending", helperOperatorId: null, decisionId: null
      })
    );
    repo.stepStates = [
      stepState({ projectStatus: "cancelled" }),
      stepState({ projectStatus: "cancelled", stepIndex: 1, stepStatus: "ready" })
    ];
    // 取消时正处缺电阻塞：helper 原地 charging 仍挂着已取消项目的步骤（纯规则只回收 working）。
    robots.operators = [makeRobot({ status: "charging", currentProjectId: "p1", currentStepIndex: 0 })];
    gateway.selectedCandidateId = "op-t1";

    const result = await detectAndResolveCooperation(tx, BASE_ID, [OTHER_STEP], deps);

    expect(repo.records.find((r) => r.requestId === "req-a")).toMatchObject({ status: "expired" });
    expect(repo.records.find((r) => r.requestId === "req-a")?.resolvedAt).not.toBeNull();
    expect(repo.records.find((r) => r.requestId === "req-p")).toMatchObject({ status: "expired" });
    expect(repo.closeReasons.get("req-a")).toBe("project_cancelled");
    expect(repo.closeReasons.get("req-p")).toBe("project_cancelled");
    expect(result.expired).toBe(2);
    expect(robots.applied).toContainEqual({
      operatorId: "op-t1", batteryWh: 9000, status: "idle", currentProjectId: null, currentStepIndex: null
    });
    // helper 不再被 reservedHelpers 占住：新缺工步骤把它列为候选并接受。
    expect(gateway.requests[0]?.candidates.map((candidate) => candidate.candidateId)).toEqual(["op-t1"]);
    expect(repo.records.find((r) => r.projectId === "p2")).toMatchObject({
      status: "accepted", helperOperatorId: "op-t1"
    });
    expect(result.helpersAccepted).toBe(1);
  });

  it("内容缺失（content_missing）阻塞的步骤：accepted 结案并释放 helper，helper 可再被选中", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    repo.records.push(openRequest());
    repo.stepStates = [stepState({ stepStatus: "blocked", blockedReason: "content_missing" })];
    robots.operators = [makeRobot({ status: "charging", currentProjectId: "p1", currentStepIndex: 0 })];
    gateway.selectedCandidateId = "op-t1";

    const result = await detectAndResolveCooperation(tx, BASE_ID, [OTHER_STEP], deps);

    expect(repo.records[0]).toMatchObject({ status: "expired" });
    expect(repo.closeReasons.get("req-a")).toBe("content_missing");
    expect(result.expired).toBe(1);
    expect(robots.operators[0]).toMatchObject({ status: "idle", currentProjectId: null, currentStepIndex: null });
    expect(repo.records.find((r) => r.projectId === "p2")).toMatchObject({
      status: "accepted", helperOperatorId: "op-t1"
    });
  });

  it("失败的项目或步骤：打开的请求结案（project_failed / step_failed）", async () => {
    const { repo, robots, deps, tx } = makeHarness();
    robots.operators = [];
    repo.records.push(
      openRequest({ requestId: "req-pf", projectId: "pf" }),
      openRequest({ requestId: "req-sf", projectId: "sf", status: "pending", helperOperatorId: null })
    );
    repo.stepStates = [
      stepState({ projectId: "pf", projectStatus: "failed" }),
      stepState({ projectId: "sf", stepStatus: "failed" })
    ];

    const result = await detectAndResolveCooperation(tx, BASE_ID, [], deps);

    expect(repo.closeReasons.get("req-pf")).toBe("project_failed");
    expect(repo.closeReasons.get("req-sf")).toBe("step_failed");
    expect(repo.records.map((r) => r.status)).toEqual(["expired", "expired"]);
    expect(result.expired).toBe(2);
  });

  it("缺电阻塞（insufficient_power）：accepted 保持，helper 保留原地充电分配（C07 复电返回）", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    repo.records.push(openRequest());
    repo.stepStates = [stepState({ stepStatus: "blocked", blockedReason: "insufficient_power" })];
    robots.operators = [makeRobot({ status: "charging", currentProjectId: "p1", currentStepIndex: 0 })];
    gateway.selectedCandidateId = "op-t1";

    const result = await detectAndResolveCooperation(tx, BASE_ID, [OTHER_STEP], deps);

    expect(repo.records[0]).toMatchObject({ status: "accepted", helperOperatorId: "op-t1" });
    expect(result.expired).toBe(0);
    expect(robots.applied).toHaveLength(0);
    expect(robots.operators[0]).toMatchObject({ status: "charging", currentProjectId: "p1", currentStepIndex: 0 });
  });

  it("步骤或项目已完成但请求仍打开：补结案为 fulfilled，不计入 expired", async () => {
    const { repo, robots, deps, tx } = makeHarness();
    robots.operators = [];
    repo.records.push(
      openRequest({ requestId: "req-step" }),
      openRequest({ requestId: "req-project", projectId: "pc", status: "pending", helperOperatorId: null })
    );
    repo.stepStates = [
      stepState({ stepStatus: "completed" }),
      stepState({ projectId: "pc", projectStatus: "completed", stepStatus: "running" })
    ];

    const result = await detectAndResolveCooperation(tx, BASE_ID, [], deps);

    expect(repo.records.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(result.expired).toBe(0);
  });

  it("取消事务已结案、但 helper 仍在该步骤原地充电：下一 tick 释放为 idle，可再被选为候选", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    repo.records.push(openRequest({ status: "expired", resolvedAt: T0 }));
    repo.stepStates = [stepState({ projectStatus: "cancelled" })];
    robots.operators = [makeRobot({ status: "charging", currentProjectId: "p1", currentStepIndex: 0 })];
    gateway.selectedCandidateId = "op-t1";

    const result = await detectAndResolveCooperation(tx, BASE_ID, [OTHER_STEP], deps);

    expect(result.expired).toBe(0); // 已结案的历史不重复计数
    expect(repo.records[0]).toMatchObject({ status: "expired" });
    expect(robots.applied[0]).toMatchObject({ operatorId: "op-t1", status: "idle", currentProjectId: null });
    expect(repo.records.find((r) => r.projectId === "p2")).toMatchObject({
      status: "accepted", helperOperatorId: "op-t1"
    });
  });

  it("状态未知（查无项目行）或 helper 已去别处：不结案、不改机器人", async () => {
    const { repo, robots, deps, tx } = makeHarness();
    repo.records.push(openRequest());
    repo.stepStates = [];
    robots.operators = [makeRobot({ status: "working", currentProjectId: "p9", currentStepIndex: 0 })];

    const result = await detectAndResolveCooperation(tx, BASE_ID, [], deps);

    expect(repo.records[0]).toMatchObject({ status: "accepted" });
    expect(result.expired).toBe(0);
    expect(robots.applied).toHaveLength(0);
  });

  it("被并发结案的请求不会被 accept 复活：不计 helpersAccepted，helper 不被预留", async () => {
    const { repo, robots, gateway, deps, tx } = makeHarness();
    robots.operators = [makeRobot()];
    gateway.selectedCandidateId = "op-t1";
    repo.records.push(openRequest({ status: "pending", helperOperatorId: null, decisionId: null }));
    // 模拟取消事务在决策期间提交：请求已被结案。
    const decide = gateway.decide.bind(gateway);
    let first = true;
    gateway.decide = async (decisionTx, request) => {
      if (first) {
        first = false;
        await repo.closeOpen(decisionTx, "req-a", "project_cancelled");
      }
      return decide(decisionTx, request);
    };

    const result = await detectAndResolveCooperation(tx, BASE_ID, [STEP, OTHER_STEP], deps);

    expect(repo.records.find((r) => r.requestId === "req-a")).toMatchObject({
      status: "expired", helperOperatorId: null
    });
    expect(result.helpersAccepted).toBe(1);
    expect(repo.records.find((r) => r.projectId === "p2")).toMatchObject({
      status: "accepted", helperOperatorId: "op-t1"
    });
  });
});
