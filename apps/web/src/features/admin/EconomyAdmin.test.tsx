import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { EconomySnapshotDto } from "@ai-mud/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EconomyAdmin } from "./EconomyAdmin";

const economySnapshot: EconomySnapshotDto = {
  settlementId: "blackpine_outpost",
  settlementName: "黑松哨站市政集市",
  generatedAt: "2026-07-01T12:00:00.000Z",
  taxSummary: {
    transactionCount: 2,
    grossCopper: 180,
    taxCopper: 9,
    buyTaxCopper: 4,
    sellTaxCopper: 5,
    netCopper: 171
  },
  marketItems: [
    {
      itemId: "wild_berry",
      name: "野莓",
      category: "food",
      itemLevel: 1,
      stockQuantity: 12,
      targetQuantity: 20,
      baseBuyPrice: { gold: 0, silver: 0, copper: 6, totalCopper: 6 },
      baseSellPrice: { gold: 0, silver: 0, copper: 10, totalCopper: 10 }
    }
  ],
  recentTransactions: [
    {
      id: "tx-1",
      settlementId: "blackpine_outpost",
      actorId: "character-1",
      actorType: "player",
      actorName: "测试角色",
      characterId: "character-1",
      transactionType: "sell",
      itemId: "wild_berry",
      itemName: "野莓",
      quantity: 3,
      unitPrice: { gold: 0, silver: 0, copper: 6, totalCopper: 6 },
      gross: { gold: 0, silver: 0, copper: 18, totalCopper: 18 },
      tax: { gold: 0, silver: 0, copper: 1, totalCopper: 1 },
      net: { gold: 0, silver: 0, copper: 17, totalCopper: 17 },
      createdAt: "2026-07-01T12:00:00.000Z"
    }
  ]
};

describe("EconomyAdmin", () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads and renders the economy snapshot", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => economySnapshot
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<EconomyAdmin />);

    expect(await screen.findByRole("heading", { name: "经济监控" })).toBeTruthy();
    expect(screen.getByText("税收合计 9 铜")).toBeTruthy();
    expect(screen.getByText("野莓")).toBeTruthy();
    expect(screen.getByText("出售 野莓 x3")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/admin/economy",
        expect.objectContaining({ credentials: "include" })
      );
    });
  });
});
