import { describe, expect, it } from "vitest";
import { toWorldRumor } from "./rumor.repository.js";

describe("rumor repository helpers", () => {
  it("serializes world rumor rows into public DTOs", () => {
    const createdAt = new Date("2026-07-02T10:00:00.000Z");

    expect(
      toWorldRumor({
        id: "rumor-1",
        sourceType: "npc_event",
        sourceId: "00000000-0000-0000-0000-000000000001",
        settlementId: "blackpine_outpost",
        audience: "public",
        message: "村里有人低声谈起：伯林的矿箱又见了底。",
        tags: ["ore_shortage"],
        generatedBy: "ai",
        createdAt,
        expiresAt: null
      })
    ).toEqual({
      id: "rumor-1",
      sourceType: "npc_event",
      sourceId: "00000000-0000-0000-0000-000000000001",
      audience: "public",
      message: "村里有人低声谈起：伯林的矿箱又见了底。",
      tags: ["ore_shortage"],
      generatedBy: "ai",
      createdAt: "2026-07-02T10:00:00.000Z",
      expiresAt: null
    });
  });
});
