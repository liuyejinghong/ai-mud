import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetLedgerHealthAdmin } from "./AssetLedgerHealthAdmin";

describe("AssetLedgerHealthAdmin", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders ledger health and bucket balances", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          generatedAt: "2026-07-06T00:00:00.000Z",
          status: "drift_detected",
          totalDrift: { gold: 0, silver: 0, copper: 20, totalCopper: 20 },
          buckets: [
            {
              bucket: "player",
              expectedCopper: { gold: 0, silver: 1, copper: 0, totalCopper: 100 },
              actualCopper: { gold: 0, silver: 0, copper: 80, totalCopper: 80 },
              driftCopper: { gold: 0, silver: 0, copper: 20, totalCopper: 20 }
            },
            {
              bucket: "system_source",
              expectedCopper: { gold: 0, silver: 1, copper: 0, totalCopper: 100 },
              actualCopper: null,
              driftCopper: null
            }
          ]
        })
      }))
    );

    render(<AssetLedgerHealthAdmin />);

    expect(await screen.findByRole("heading", { name: "账本守恒" })).toBeTruthy();
    expect(await screen.findByText("发现漂移")).toBeTruthy();
    expect(screen.getByText("漂移合计 20 铜")).toBeTruthy();
    expect(screen.getByText("玩家")).toBeTruthy();
    expect(screen.getAllByText("不适用")).toHaveLength(2);
  });
});
