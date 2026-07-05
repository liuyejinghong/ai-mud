import { describe, expect, it, vi } from "vitest";
import {
  WORLD_RESET_CONFIRMATION_TEXT,
  WorldResetService,
  WorldResetServiceError
} from "./world-reset.service.js";

describe("WorldResetService", () => {
  it("rejects reset without exact confirmation text", async () => {
    const service = new WorldResetService({
      repository: {
        resetWorldState: vi.fn(),
        seedBaseWorld: vi.fn()
      },
      audit: { write: vi.fn() }
    });

    await expect(
      service.resetWorld({
        actorAccountId: "admin-1",
        confirmationText: "RESET WORLD",
        reason: "economy test reset"
      })
    ).rejects.toMatchObject(
      new WorldResetServiceError("VALIDATION_ERROR", "确认短语不正确。")
    );
  });

  it("rejects reset without a meaningful reason", async () => {
    const service = new WorldResetService({
      repository: {
        resetWorldState: vi.fn(),
        seedBaseWorld: vi.fn()
      },
      audit: { write: vi.fn() }
    });

    await expect(
      service.resetWorld({
        actorAccountId: "admin-1",
        confirmationText: WORLD_RESET_CONFIRMATION_TEXT,
        reason: "bug"
      })
    ).rejects.toMatchObject(
      new WorldResetServiceError("VALIDATION_ERROR", "请填写至少 8 个字的重置原因。")
    );
  });

  it("audits request and completion around one real world reset", async () => {
    const calls: unknown[] = [];
    const service = new WorldResetService({
      repository: {
        resetWorldState: vi.fn(async (input) => {
          calls.push({ type: "reset", input });
          return { clearedTables: ["characters", "world_actors"] };
        }),
        seedBaseWorld: vi.fn(async (input) => {
          calls.push({ type: "seed", input });
        })
      },
      audit: {
        write: vi.fn(async (input) => {
          calls.push({ type: "audit", input });
        })
      },
      now: () => new Date("2026-07-05T12:00:00.000Z")
    });

    const result = await service.resetWorld({
      actorAccountId: "admin-1",
      confirmationText: WORLD_RESET_CONFIRMATION_TEXT,
      reason: "经济系统崩溃后重置"
    });

    expect(result).toEqual({
      ok: true,
      mode: "world_reset",
      resetAt: "2026-07-05T12:00:00.000Z",
      clearedTables: ["characters", "world_actors"],
      message: "世界已重置并完成基础初始化。"
    });
    expect(calls).toEqual([
      {
        type: "audit",
        input: {
          actorAccountId: "admin-1",
          action: "world_reset.request",
          targetType: "world",
          targetId: null,
          reason: "经济系统崩溃后重置",
          metadata: { confirmationText: WORLD_RESET_CONFIRMATION_TEXT }
        }
      },
      {
        type: "reset",
        input: { resetAt: new Date("2026-07-05T12:00:00.000Z") }
      },
      {
        type: "seed",
        input: { resetAt: new Date("2026-07-05T12:00:00.000Z") }
      },
      {
        type: "audit",
        input: {
          actorAccountId: "admin-1",
          action: "world_reset.complete",
          targetType: "world",
          targetId: null,
          reason: "经济系统崩溃后重置",
          metadata: {
            clearedTables: ["characters", "world_actors"],
            resetAt: "2026-07-05T12:00:00.000Z"
          }
        }
      }
    ]);
  });
});
