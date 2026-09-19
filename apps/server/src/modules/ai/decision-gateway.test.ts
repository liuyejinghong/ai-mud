// M14-A 决策网关测试（审计经注入写入口捕获；网关不触真库）。
import { describe, expect, it } from "vitest";
import type { DecisionRequestDto } from "@ai-mud/shared";
import { RuleDecisionProvider, type DecisionProvider, type DecisionProviderRequest } from "./decision-provider.js";
import { DecisionGateway, DECISION_RULE_MODE, type DecisionAuditRow } from "./decision-gateway.js";

const BASE_ID = "0b8f6c1e-1111-4222-8333-444455556666";

function makeRequest(overrides: Partial<DecisionRequestDto> = {}): DecisionRequestDto {
  return {
    decisionId: "decision-1",
    purpose: "transport_assistance",
    baseId: BASE_ID,
    epoch: 1,
    planRevision: 3,
    question: "谁支援运输？",
    candidates: [
      { candidateId: "op-a", summary: "望山-1", score: 0.4 },
      { candidateId: "op-b", summary: "望山-2", score: 0.9 }
    ],
    deadlineMs: 2000,
    ...overrides
  };
}

interface CapturedAudit extends DecisionAuditRow {}

function makeAuditCapture(overrides: { failWrite?: boolean } = {}) {
  const rows: CapturedAudit[] = [];
  const recordAudit = async (row: CapturedAudit) => {
    rows.push(row);
    if (overrides.failWrite) {
      throw new Error("audit write failed");
    }
  };
  return { rows, recordAudit };
}

describe("DecisionGateway.decide", () => {
  it("审计落库：行含 decisionId/purpose/mode/provider/候选/selected/latency", async () => {
    const { rows, recordAudit } = makeAuditCapture();
    const gateway = new DecisionGateway({ recordAudit, clock: { now: () => new Date(0) } });

    const outcome = await gateway.decide({} as never, makeRequest());

    expect(outcome.selectedCandidateId).toBe("op-b");
    expect(outcome.mode).toBe(DECISION_RULE_MODE);
    expect(outcome.provider).toBe("rule");
    expect(outcome.reason).toBe("选择电量最充足的支援设备");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decisionId: "decision-1",
      purpose: "transport_assistance",
      mode: "rule",
      provider: "rule",
      baseId: BASE_ID,
      planRevision: 3,
      selectedCandidateId: "op-b"
    });
    expect(rows[0]?.candidates).toEqual(makeRequest().candidates);
  });

  it("超时保护：provider 慢于窗口 → abstain、provider='timeout'，审计照落", async () => {
    const { rows, recordAudit } = makeAuditCapture();
    const slowProvider: DecisionProvider = {
      decide: () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ selectedCandidateId: "op-a", provider: "rule", reason: "迟到结果" }),
            50
          );
        })
    };
    const gateway = new DecisionGateway({
      recordAudit,
      provider: slowProvider,
      clock: { now: () => new Date(0) },
      timeoutMs: 5
    });

    const outcome = await gateway.decide({} as never, makeRequest());

    expect(outcome.selectedCandidateId).toBeNull();
    expect(outcome.provider).toBe("timeout");
    expect(outcome.mode).toBe("rule");
    expect(rows[0]?.provider).toBe("timeout");
    expect(rows[0]?.selectedCandidateId).toBeNull();
  });

  it("审计写失败不吞：抛出让调用方事务回滚", async () => {
    const { recordAudit } = makeAuditCapture({ failWrite: true });
    const gateway = new DecisionGateway({ recordAudit });

    await expect(gateway.decide({} as never, makeRequest())).rejects.toThrow("audit write failed");
  });

  it("候选透传：provider 只收到 candidateId+score 投影与 purpose/question/deadlineMs", async () => {
    const seen: DecisionProviderRequest[] = [];
    const spyProvider: DecisionProvider = {
      decide: (request) => {
        seen.push(request);
        return Promise.resolve({
          selectedCandidateId: "op-a",
          provider: "rule",
          reason: "规则选择"
        });
      }
    };
    const { recordAudit } = makeAuditCapture();
    const gateway = new DecisionGateway({ recordAudit, provider: spyProvider });

    await gateway.decide({} as never, makeRequest());

    expect(seen).toHaveLength(1);
    expect(seen[0]?.candidates).toEqual([
      { candidateId: "op-a", score: 0.4 },
      { candidateId: "op-b", score: 0.9 }
    ]);
    expect(seen[0]?.purpose).toBe("transport_assistance");
  });

  it("provider 返回候选外 ID：视为弃权并照实审计（不改候选语义）", async () => {
    const { rows, recordAudit } = makeAuditCapture();
    const rogueProvider: DecisionProvider = {
      decide: () =>
        Promise.resolve({
          selectedCandidateId: "op-z",
          provider: "rogue",
          reason: "越权选择"
        })
    };
    const gateway = new DecisionGateway({ recordAudit, provider: rogueProvider });

    const outcome = await gateway.decide({} as never, makeRequest());

    expect(outcome.selectedCandidateId).toBeNull();
    expect(outcome.mode).toBe("rule");
    expect(rows[0]?.provider).toBe("rogue");
    expect(rows[0]?.selectedCandidateId).toBeNull();
  });

  it("默认 provider 未注入时安全回退 RULE", async () => {
    const { rows, recordAudit } = makeAuditCapture();
    const gateway = new DecisionGateway({ recordAudit });

    const outcome = await gateway.decide({} as never, makeRequest());

    expect(outcome.provider).toBe("rule");
    expect(outcome.selectedCandidateId).toBe("op-b");
    expect(rows).toHaveLength(1);
  });

  it("迟到结果不重复审计（race 后旧 promise 结果被丢弃）", async () => {
    const { rows, recordAudit } = makeAuditCapture();
    let resolveLate: (value: { selectedCandidateId: string; provider: string; reason: string }) => void =
      () => undefined;
    const slowProvider: DecisionProvider = {
      decide: () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        })
    };
    const gateway = new DecisionGateway({
      recordAudit,
      provider: slowProvider,
      clock: { now: () => new Date(0) },
      timeoutMs: 5
    });

    const outcome = await gateway.decide({} as never, makeRequest());
    expect(outcome.provider).toBe("timeout");
    resolveLate({ selectedCandidateId: "op-a", provider: "rule", reason: "迟到" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(rows).toHaveLength(1);
  });
});
