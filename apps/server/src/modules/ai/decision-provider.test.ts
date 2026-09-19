// M14-A 决策提供者测试（纯规则，无 IO 假体）。
import { describe, expect, it } from "vitest";
import { RuleDecisionProvider } from "./decision-provider.js";

const provider = new RuleDecisionProvider();

function request(overrides: Partial<Parameters<typeof provider.decide>[0]> = {}) {
  return {
    purpose: "transport_assistance" as const,
    question: "工程组请求运输支援，哪台设备出工？",
    candidates: [] as Array<{ candidateId: string; score: number }>,
    deadlineMs: 2000,
    ...overrides
  };
}

describe("RuleDecisionProvider.decide", () => {
  it("选最高分候选，reason 为 transport_assistance 中文一句话", async () => {
    const result = await provider.decide(
      request({
        candidates: [
          { candidateId: "op-a", score: 0.4 },
          { candidateId: "op-b", score: 0.9 },
          { candidateId: "op-c", score: 0.6 }
        ]
      })
    );

    expect(result.selectedCandidateId).toBe("op-b");
    expect(result.provider).toBe("rule");
    expect(result.reason).toBe("选择电量最充足的支援设备");
  });

  it("并列最高分取 candidateId 字典序最小，保证确定性", async () => {
    const input = request({
      candidates: [
        { candidateId: "op-c", score: 0.8 },
        { candidateId: "op-a", score: 0.8 },
        { candidateId: "op-b", score: 0.8 }
      ]
    });

    const first = await provider.decide(input);
    const second = await provider.decide(input);

    expect(first.selectedCandidateId).toBe("op-a");
    // 同输入同输出（可重放、可审计）。
    expect(second).toEqual(first);
  });

  it("空候选弃权：selectedCandidateId 为 null", async () => {
    const result = await provider.decide(request({ candidates: [] }));

    expect(result.selectedCandidateId).toBeNull();
    expect(result.provider).toBe("rule");
    expect(result.reason).toContain("弃权");
  });

  it("相同分数集合按不同输入顺序仍选同一候选（输入序不敏感）", async () => {
    const a = await provider.decide(
      request({
        candidates: [
          { candidateId: "op-x", score: 0.5 },
          { candidateId: "op-y", score: 0.7 }
        ]
      })
    );
    const b = await provider.decide(
      request({
        candidates: [
          { candidateId: "op-y", score: 0.7 },
          { candidateId: "op-x", score: 0.5 }
        ]
      })
    );

    expect(a.selectedCandidateId).toBe("op-y");
    expect(b.selectedCandidateId).toBe("op-y");
  });

  it("未知 purpose 回退通用 reason，不抛", async () => {
    const result = await provider.decide(
      request({
        purpose: "work_assignment",
        candidates: [{ candidateId: "op-a", score: 0.1 }]
      })
    );

    expect(result.selectedCandidateId).toBe("op-a");
    expect(result.reason).toBe("选择评分最高的候选");
  });
});
