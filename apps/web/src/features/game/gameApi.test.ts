import { afterEach, describe, expect, it, vi } from "vitest";
import { GameApiError, getGameState } from "./gameApi";

describe("gameApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws structured server validation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: "VALIDATION_ERROR", message: "背包物品不足。" }
        })
      }))
    );

    await expect(getGameState()).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "背包物品不足。"
    });
  });

  it("uses a clear authentication-expired fallback for bare 401 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => {
          throw new Error("no json");
        }
      }))
    );

    await expect(getGameState()).rejects.toBeInstanceOf(GameApiError);
    await expect(getGameState()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
      message: "登录已失效，请重新登录。"
    });
  });
});
