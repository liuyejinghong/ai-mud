import { cleanup, render, screen } from "@testing-library/react";
import type { AiLayerStatusDto, AssetLedgerHealthDto, WorldRuntimeStatusDto } from "@ai-mud/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorldHealthAdmin } from "./WorldHealthAdmin";

const runtime: WorldRuntimeStatusDto = {
  key: "npc_world",
  generatedAt: "2026-07-01T12:00:00.000Z",
  lastSettledAt: "2026-07-01T11:59:00.000Z",
  nextTickAt: "2026-07-01T12:00:00.000Z",
  leaseOwner: null,
  leaseUntil: null
};

const ledger: AssetLedgerHealthDto = {
  generatedAt: "2026-07-01T12:00:00.000Z",
  status: "ok",
  totalDrift: { gold: 0, silver: 0, copper: 0, totalCopper: 0 },
  buckets: []
};

const ai: AiLayerStatusDto = {
  providerEnabled: true,
  providerName: "deepseek",
  model: "deepseek-v4-flash",
  promptVersion: 8,
  budget: {
    dailyTokenBudget: 1000,
    usedTokens24h: 226,
    remainingTokens24h: 774,
    fallbackCount24h: 1,
    latestFailureReason: null,
    exhausted: false
  },
  purposes: []
};

describe("WorldHealthAdmin", () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders one-screen closed beta health signals", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => runtime })
      .mockResolvedValueOnce({ ok: true, json: async () => ledger })
      .mockResolvedValueOnce({ ok: true, json: async () => ai });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldHealthAdmin />);

    expect(await screen.findByRole("heading", { name: "世界健康总览" })).toBeTruthy();
    expect(await screen.findByText("Tick 正常")).toBeTruthy();
    expect(screen.getByText("经济守恒")).toBeTruthy();
    expect(screen.getByText("AI 余量 774")).toBeTruthy();
    expect(screen.queryByText("NPC 生存")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3000/admin/world-runtime", {
      credentials: "include"
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3000/admin/asset-ledger/health", {
      credentials: "include"
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3000/admin/ai-layer/status", {
      credentials: "include"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
