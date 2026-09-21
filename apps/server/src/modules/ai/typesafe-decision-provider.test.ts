// TypeSafe SHADOW provider 测试：注入假 fetch，验证对照行为与安全回退。
import { describe, expect, it } from "vitest";
import { TypeSafeShadowDecisionProvider } from "./typesafe-decision-provider.js";

const REQUEST = {
  purpose: "transport_assistance" as const,
  question: "谁支援运输？",
  candidates: [
    { candidateId: "op-a", score: 0.4 },
    { candidateId: "op-b", score: 0.9 }
  ],
  deadlineMs: 2000
};

function makeProvider(
  body: unknown,
  ok = true
): TypeSafeShadowDecisionProvider {
  return new TypeSafeShadowDecisionProvider({
    apiKey: "test-key",
    fetchImpl: (async () =>
      new Response(JSON.stringify(body), {
        status: ok ? 200 : 500,
        headers: { "Content-Type": "application/json" }
      })) as typeof fetch
  });
}

describe("TypeSafeShadowDecisionProvider", () => {
  it("执行语义保持 RULE：选择仍是规则结果，provider 名标注对照", async () => {
    const provider = makeProvider({
      choices: [{ message: { content: "建议选 op-b，电量最足。" } }]
    });

    const outcome = await provider.decide(REQUEST);

    expect(outcome.selectedCandidateId).toBe("op-b");
    expect(outcome.provider).toBe("typesafe-shadow");
    expect(outcome.reason).toContain("Jev 对照");
    expect(outcome.reason).toContain("建议选 op-b");
  });

  it("Jev HTTP 失败：安全回退规则结果并注明对照不可用", async () => {
    const provider = makeProvider({ error: "boom" }, false);

    const outcome = await provider.decide(REQUEST);

    expect(outcome.selectedCandidateId).toBe("op-b");
    expect(outcome.reason).toContain("Jev 对照不可用");
  });

  it("Jev 空内容：同样安全回退", async () => {
    const provider = makeProvider({ choices: [{ message: { content: "" } }] });

    const outcome = await provider.decide(REQUEST);

    expect(outcome.reason).toContain("Jev 对照不可用");
  });
});
