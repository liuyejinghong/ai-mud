import { cleanup, render, screen } from "@testing-library/react";
import type { AiLayerStatusDto } from "@ai-mud/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiLayerStatusAdmin } from "./AiLayerStatusAdmin";

const snapshot: AiLayerStatusDto = {
  providerEnabled: true,
  providerName: "deepseek",
  model: "deepseek-v4-flash",
  promptVersion: 6,
  purposes: [
    {
      purpose: "npc_dialogue",
      authorityClass: "presentation",
      enabled: true,
      mutatesWorldState: false,
      maxOutputTokens: 180,
      cooldownMs: 5000,
      fallbackRequired: true,
      promptVersion: 3,
      callCount24h: 2,
      successCount24h: 1,
      fallbackCount24h: 0,
      rejectedCount24h: 0,
      errorCount24h: 0,
      disabledCount24h: 1,
      totalInputTokens24h: 120,
      totalOutputTokens24h: 36,
      averageLatencyMs24h: 240,
      latestStatus: "disabled",
      latestAt: "2026-07-02T12:00:00.000Z"
    },
    {
      purpose: "world_rumor",
      authorityClass: "presentation",
      enabled: true,
      mutatesWorldState: false,
      maxOutputTokens: 120,
      cooldownMs: 0,
      fallbackRequired: true,
      promptVersion: 6,
      callCount24h: 1,
      successCount24h: 1,
      fallbackCount24h: 0,
      rejectedCount24h: 0,
      errorCount24h: 0,
      disabledCount24h: 0,
      totalInputTokens24h: 70,
      totalOutputTokens24h: 18,
      averageLatencyMs24h: 120,
      latestStatus: "success",
      latestAt: "2026-07-02T11:00:00.000Z"
    }
  ]
};

describe("AiLayerStatusAdmin", () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders purpose governance rows with world mutation forbidden", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => snapshot });
    vi.stubGlobal("fetch", fetchMock);

    render(<AiLayerStatusAdmin />);

    expect(await screen.findByRole("heading", { name: "AI 状态" })).toBeTruthy();
    expect(screen.getByText("deepseek/deepseek-v4-flash")).toBeTruthy();
    expect(screen.getByText("npc_dialogue")).toBeTruthy();
    expect(screen.getByText("world_rumor")).toBeTruthy();
    expect(screen.getByText("5000ms")).toBeTruthy();
    expect(screen.getByText("1/0/0/0/1")).toBeTruthy();
    expect(screen.getAllByText("禁止")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3000/admin/ai-layer/status", {
      credentials: "include"
    });
  });
});
