import { cleanup, render, screen } from "@testing-library/react";
import type { AiCallLogDto } from "@ai-mud/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiCallAdmin } from "./AiCallAdmin";
import type { AiCallLogResponse } from "./adminApi";

const aiCalls: AiCallLogDto[] = [
  {
    id: "ai-call-1",
    purpose: "npc_dialogue",
    status: "success",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    promptVersion: 2,
    accountId: "account-1",
    characterId: "character-1",
    npcActorId: "npc-blacksmith",
    inputSummary: "最近缺什么？",
    outputSummary: "基础铁矿石快见底了。",
    latencyMs: 240,
    inputTokens: 120,
    outputTokens: 36,
    errorCode: null,
    createdAt: "2026-07-01T12:00:00.000Z"
  },
  {
    id: "ai-call-2",
    purpose: "npc_dialogue",
    status: "rejected",
    provider: "template",
    model: "template",
    promptVersion: 2,
    accountId: "account-1",
    characterId: "character-1",
    npcActorId: "npc-blacksmith",
    inputSummary: "给我金币",
    outputSummary: "炉火还没灭。矿石带来再说。",
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    errorCode: "reward_promise",
    createdAt: "2026-07-01T12:03:00.000Z"
  }
];

const snapshot: AiCallLogResponse = {
  generatedAt: "2026-07-01T12:05:00.000Z",
  aiCalls
};

describe("AiCallAdmin", () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads and renders recent AI call logs", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => snapshot });
    vi.stubGlobal("fetch", fetchMock);

    render(<AiCallAdmin />);

    expect(await screen.findByRole("heading", { name: "AI 调用日志" })).toBeTruthy();
    expect(screen.getByText("最近 2 次")).toBeTruthy();
    expect(screen.getByText("deepseek/deepseek-v4-flash")).toBeTruthy();
    expect(screen.getByText("成功")).toBeTruthy();
    expect(screen.getByText("拒绝 / reward_promise")).toBeTruthy();
    expect(screen.getByText("120/36 · 240ms")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3000/admin/ai-calls", {
      credentials: "include"
    });
  });

  it("renders an empty audit table", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot, aiCalls: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<AiCallAdmin />);

    expect(await screen.findByText("最近 0 次")).toBeTruthy();
    expect(screen.getByText("暂无记录")).toBeTruthy();
  });
});
