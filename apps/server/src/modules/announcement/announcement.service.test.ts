import { describe, expect, it, vi } from "vitest";
import { AnnouncementService } from "./announcement.service.js";

describe("AnnouncementService", () => {
  it("writes one admin announcement, public sync event, and audit record", async () => {
    const calls: unknown[] = [];
    const service = new AnnouncementService({
      repository: {
        createSystemAnnouncement: vi.fn(async (input) => {
          calls.push({ type: "announcement", input });
          return {
            id: "announcement-1",
            adminAccountId: input.adminAccountId,
            body: input.body,
            severity: "info" as const,
            createdAt: input.createdAt
          };
        }),
        writePublicSyncEvent: vi.fn(async (input) => {
          calls.push({ type: "sync", input });
          return 12;
        })
      },
      audit: {
        write: vi.fn(async (input) => {
          calls.push({ type: "audit", input });
        })
      },
      now: () => new Date("2026-07-05T12:00:00.000Z")
    });

    const result = await service.publish({
      adminAccountId: "admin-1",
      body: "今晚 22:00 将进行世界重置演练。"
    });

    expect(result).toEqual({
      id: "announcement-1",
      characterId: "system",
      characterName: "系统公告",
      kind: "system",
      channel: "lobby",
      body: "今晚 22:00 将进行世界重置演练。",
      createdAt: "2026-07-05T12:00:00.000Z"
    });
    expect(calls).toEqual([
      expect.objectContaining({ type: "announcement" }),
      expect.objectContaining({
        type: "sync",
        input: expect.objectContaining({
          eventType: "system.announcement",
          payload: { announcementId: "announcement-1", severity: "info" }
        })
      }),
      expect.objectContaining({
        type: "audit",
        input: expect.objectContaining({
          actorAccountId: "admin-1",
          action: "system_announcement.publish",
          targetType: "system_announcement",
          targetId: "announcement-1"
        })
      })
    ]);
  });

  it("rejects empty or overlong announcement bodies", async () => {
    const service = new AnnouncementService({
      repository: {
        createSystemAnnouncement: vi.fn(),
        writePublicSyncEvent: vi.fn()
      },
      audit: { write: vi.fn() }
    });

    await expect(service.publish({ adminAccountId: "admin-1", body: "  " })).rejects.toMatchObject({
      code: "VALIDATION_ERROR"
    });
    await expect(
      service.publish({ adminAccountId: "admin-1", body: "长".repeat(241) })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
