import { describe, expect, it } from "vitest";
import {
  describeDecisionInput,
  describeDecisionOutcome,
  describeDecisionPurposeLabel
} from "./decision.js";

const candidates = [
  { candidateId: "cand-a", summary: "先运电缆到建设位 A" },
  { candidateId: "cand-b", summary: "先运支架到建设位 B" }
];

describe("decision prompt templates", () => {
  it("输入描述包含目的、问题与候选数", () => {
    const text = describeDecisionInput("transport_assistance", "先运哪批物资？", candidates);

    expect(text).toContain("工程组请求运输支援");
    expect(text).toContain("先运哪批物资？");
    expect(text).toContain("共 2 个候选");
    expect(text).toContain("cand-a 先运电缆到建设位 A");
    expect(text).toContain("cand-b 先运支架到建设位 B");
  });

  it("没有候选时输入描述给出 0 个候选", () => {
    const text = describeDecisionInput("work_assignment", "先派谁去？", []);

    expect(text).toContain("多候选设备或工单选择");
    expect(text).toContain("共 0 个候选");
  });

  it("输出描述包含选中候选与原因", () => {
    const text = describeDecisionOutcome("transport_assistance", "cand-a", "电缆路径更短");

    expect(text).toContain("工程组请求运输支援");
    expect(text).toContain("cand-a");
    expect(text).toContain("电缆路径更短");
  });

  it("弃权时输出描述说明弃权并保留原因", () => {
    const text = describeDecisionOutcome("work_assignment", null, "候选收益都不可靠");

    expect(text).toContain("弃权");
    expect(text).toContain("候选收益都不可靠");
    expect(text).not.toContain("cand-");
  });

  it("未知 purpose 原样回显，不抛错", () => {
    expect(describeDecisionPurposeLabel("future_purpose")).toBe("future_purpose");
    expect(describeDecisionInput("future_purpose", "怎么做？", candidates)).toContain(
      "future_purpose"
    );
    expect(describeDecisionOutcome("future_purpose", "cand-a", "默认规则")).toContain(
      "future_purpose"
    );
  });

  it("相同输入产出完全一致的描述（可重放审计）", () => {
    const inputFirst = describeDecisionInput("transport_assistance", "先运哪批物资？", candidates);
    const inputSecond = describeDecisionInput("transport_assistance", "先运哪批物资？", candidates);
    const outcomeFirst = describeDecisionOutcome("transport_assistance", "cand-b", "支架更急");
    const outcomeSecond = describeDecisionOutcome("transport_assistance", "cand-b", "支架更急");

    expect(inputFirst).toBe(inputSecond);
    expect(outcomeFirst).toBe(outcomeSecond);
  });
});
