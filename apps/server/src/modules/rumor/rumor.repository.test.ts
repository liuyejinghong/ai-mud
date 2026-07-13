import { describe, expect, it } from "vitest";
import { npcEvents, worldRumors } from "../../db/schema.js";
import { RumorRepository, toWorldRumor } from "./rumor.repository.js";

describe("rumor repository helpers", () => {
  it("filters a candidate source set with one rumor lookup instead of per-source reads", async () => {
    let selectCount = 0;
    const sourceRows = [
      npcEventRow("00000000-0000-0000-0000-000000000001"),
      npcEventRow("00000000-0000-0000-0000-000000000002"),
      npcEventRow("00000000-0000-0000-0000-000000000003")
    ];
    const existingRumors = [{
      sourceType: "npc_event",
      sourceId: "00000000-0000-0000-0000-000000000002"
    }];
    const db = {
      select: () => {
        selectCount += 1;
        return {
          from: (table: unknown) => {
            if (table === npcEvents) {
              return { orderBy: () => ({ limit: async () => sourceRows }) };
            }
            if (table === worldRumors) {
              const rows = Promise.resolve(existingRumors);
              return {
                where: () => Object.assign(rows, { limit: async () => existingRumors })
              };
            }
            throw new Error("Unexpected table");
          }
        };
      }
    };
    const repo = new RumorRepository(db as never);

    const candidates = await repo.listUnrumoredNpcEvents(3);

    expect(candidates.map((candidate) => candidate.sourceId)).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000003"
    ]);
    expect(selectCount).toBe(2);
  });

  it("returns null when another worker wins the source insert conflict", async () => {
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: async () => [] })
        })
      })
    };
    const repo = new RumorRepository(db as never);

    await expect(
      repo.insertRumor({
        sourceType: "npc_event",
        sourceId: "00000000-0000-0000-0000-000000000001",
        settlementId: "blackpine_outpost",
        audience: "public",
        message: "村里有人低声谈起：伯林的矿箱又见了底。",
        tags: ["ore_shortage"],
        generatedBy: "ai"
      })
    ).resolves.toBeNull();
  });

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

function npcEventRow(id: string) {
  return {
    id,
    actorId: null,
    eventType: "ore_shortage",
    message: `event ${id}`,
    metadata: {},
    createdAt: new Date("2026-07-02T10:00:00.000Z")
  };
}
