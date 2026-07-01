import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NpcSimulationReportDto, WorldRuntimeStatusDto } from "@ai-mud/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NpcAdmin } from "./NpcAdmin";
import type { NpcSnapshotResponse } from "./adminApi";

const npcSnapshot: NpcSnapshotResponse = {
  generatedAt: "2026-07-01T09:00:00.000Z",
  settlementId: "blackpine_outpost",
  treasury: { gold: 0, silver: 99, copper: 75, totalCopper: 9975 },
  npcs: [
    {
      id: "actor-farmer",
      actorType: "npc",
      npcKey: "blackpine_farmer_mara",
      name: "玛拉",
      profession: "farmer",
      currentLocation: "corrupt_forest",
      position: { x: 1, y: 3 },
      money: { gold: 0, silver: 1, copper: 25, totalCopper: 125 },
      hunger: {
        current: 4,
        max: 5,
        status: "fed",
        nextMealAt: "2026-07-01T18:00:00.000Z"
      },
      currentAction: { actionType: "gathering", description: "正在采集" },
      inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 2 }],
      recentEvents: [
        {
          id: "event-1",
          message: "玛拉开始采集野莓。",
          createdAt: "2026-07-01T09:00:00.000Z"
        }
      ]
    }
  ]
};

const simulationReport: NpcSimulationReportDto = {
  startedAt: "2026-07-01T00:00:00.000Z",
  endedAt: "2026-07-02T00:00:00.000Z",
  days: 1,
  settlementId: "blackpine_outpost",
  treasury: { gold: 0, silver: 99, copper: 75, totalCopper: 9975 },
  npcCount: 4,
  actionCount: 12,
  marketTransactionCount: 3,
  resourceSnapshots: [{ resourceId: "forest_berry_patch_01", name: "野莓灌木", remainingCharges: 2 }],
  health: { ok: true, issues: [] }
};

const runtimeStatus: WorldRuntimeStatusDto = {
  key: "npc_world",
  generatedAt: "2026-07-01T12:00:00.000Z",
  lastSettledAt: "2026-07-01T11:59:00.000Z",
  nextTickAt: "2026-07-01T12:00:00.000Z",
  leaseOwner: null,
  leaseUntil: null
};

describe("NpcAdmin", () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads and renders NPC state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => npcSnapshot })
      .mockResolvedValueOnce({ ok: true, json: async () => runtimeStatus });
    vi.stubGlobal("fetch", fetchMock);

    render(<NpcAdmin csrfToken="csrf-token" />);

    expect(await screen.findByRole("heading", { name: "NPC 运行监控" })).toBeTruthy();
    expect(screen.getByText("市政金库 9975 铜")).toBeTruthy();
    expect(screen.getByText("玛拉")).toBeTruthy();
    expect(screen.getByText("farmer")).toBeTruthy();
    expect(screen.getByText("腐林 (1, 3)")).toBeTruthy();
    expect(screen.getByText("正在采集")).toBeTruthy();
    expect(screen.getByText("野莓 x2")).toBeTruthy();
    expect(screen.getByText("玛拉开始采集野莓。")).toBeTruthy();
    expect(screen.getByText("上次结算")).toBeTruthy();
    expect(screen.getByText("2026-07-01 11:59")).toBeTruthy();
    expect(screen.getByText("下次 Tick")).toBeTruthy();
    expect(screen.getByText("2026-07-01 12:00")).toBeTruthy();
  });

  it("settles the NPC world and renders simulation health", async () => {
    const settledSnapshot: NpcSnapshotResponse = {
      ...npcSnapshot,
      generatedAt: "2026-07-01T09:05:00.000Z"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => npcSnapshot })
      .mockResolvedValueOnce({ ok: true, json: async () => runtimeStatus })
      .mockResolvedValueOnce({ ok: true, json: async () => settledSnapshot })
      .mockResolvedValueOnce({ ok: true, json: async () => runtimeStatus })
      .mockResolvedValueOnce({ ok: true, json: async () => simulationReport });
    vi.stubGlobal("fetch", fetchMock);

    render(<NpcAdmin csrfToken="csrf-token" />);

    fireEvent.click(await screen.findByRole("button", { name: "推进 NPC 世界" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/admin/npcs/settle",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: expect.objectContaining({ "x-ai-mud-csrf": "csrf-token" })
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "运行 1 天仿真" }));
    expect(await screen.findByText("仿真健康：正常")).toBeTruthy();
    expect(screen.getByText("行动 12 次 · 交易 3 笔")).toBeTruthy();
  });
});
