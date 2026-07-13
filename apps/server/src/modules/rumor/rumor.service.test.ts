import type { WorldRumorDto } from "@ai-mud/shared";
import { describe, expect, it } from "vitest";
import type { CreateAiCallLogInput } from "../dialogue/dialogue.repository.js";
import { RumorService, buildFallbackRumorMessage, type RumorRepositoryPort } from "./rumor.service.js";
import type { RumorSourceRecord } from "./rumor.repository.js";

class FakeRumorRepo implements RumorRepositoryPort {
  npcSources: RumorSourceRecord[] = [];
  gameSources: RumorSourceRecord[] = [];
  rumored = new Set<string>();
  inserted: WorldRumorDto[] = [];
  returnStaleCandidates = false;

  async listRecentPublicRumors(limit: number) {
    return this.inserted.slice(0, limit);
  }

  async listUnrumoredNpcEvents() {
    return this.returnStaleCandidates
      ? this.npcSources
      : this.npcSources.filter((source) => !this.rumored.has(key(source)));
  }

  async listUnrumoredGameEvents() {
    return this.returnStaleCandidates
      ? this.gameSources
      : this.gameSources.filter((source) => !this.rumored.has(key(source)));
  }

  async insertRumor(input: Parameters<RumorRepositoryPort["insertRumor"]>[0]) {
    const sourceKey = input.sourceId ? `${input.sourceType}:${input.sourceId}` : null;
    if (sourceKey && this.rumored.has(sourceKey)) return null;
    if (sourceKey) this.rumored.add(sourceKey);
    const rumor: WorldRumorDto = {
      id: `rumor-${this.inserted.length + 1}`,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      audience: "public",
      message: input.message,
      tags: input.tags,
      generatedBy: input.generatedBy,
      createdAt: input.createdAt?.toISOString() ?? "2026-07-02T00:00:00.000Z",
      expiresAt: input.expiresAt?.toISOString() ?? null
    };
    this.inserted.push(rumor);
    return rumor;
  }
}

function npcSource(overrides: Partial<RumorSourceRecord> = {}): RumorSourceRecord {
  return {
    sourceType: "npc_event",
    sourceId: "event-1",
    sourceMessage: "伯林发现基础铁矿石库存偏低。",
    npcActorId: "npc-blacksmith",
    sourceActorName: "伯林",
    sourceLocationName: "黑松哨站",
    createdAt: new Date("2026-07-02T10:00:00.000Z"),
    tags: ["ore_shortage"],
    ...overrides
  };
}

function gameSource(overrides: Partial<RumorSourceRecord> = {}): RumorSourceRecord {
  return {
    sourceType: "game_event",
    sourceId: "game-event-1",
    sourceMessage: "你向东移动，继续探索旧矿坑。",
    npcActorId: null,
    sourceActorName: null,
    sourceLocationName: "旧矿坑",
    createdAt: new Date("2026-07-02T10:00:00.000Z"),
    tags: ["character.move"],
    ...overrides
  };
}

describe("RumorService", () => {
  it("builds bounded deterministic fallback rumor messages", () => {
    expect(buildFallbackRumorMessage("伯林发现基础铁矿石库存偏低。")).toBe(
      "村里有人低声谈起：伯林发现基础铁矿石库存偏低。"
    );
    expect([...buildFallbackRumorMessage("黑".repeat(100))].length).toBeLessThanOrEqual(80);
  });

  it("creates template rumors from real source events when no AI generator is provided", async () => {
    const repo = new FakeRumorRepo();
    repo.npcSources = [npcSource()];
    const service = new RumorService(repo);

    const created = await service.syncRumors({
      now: new Date("2026-07-02T12:00:00.000Z")
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.message).toContain("基础铁矿石库存偏低");
    expect(created[0]?.generatedBy).toBe("template");
  });

  it("uses accepted AI rumor text and writes an audit log", async () => {
    const repo = new FakeRumorRepo();
    repo.npcSources = [npcSource()];
    const logs: CreateAiCallLogInput[] = [];
    const service = new RumorService(
      repo,
      {
        generateRumor: async () => ({
          message: "村里有人低声谈起：伯林的矿箱又见了底。",
          status: "success",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          fallbackReason: null,
          inputTokens: 80,
          outputTokens: 20,
          latencyMs: 30
        })
      },
      { createAiCallLog: async (input) => void logs.push(input) }
    );

    const created = await service.syncRumors({
      now: new Date("2026-07-02T12:00:00.000Z")
    });

    expect(created[0]?.generatedBy).toBe("ai");
    expect(created[0]?.message).toContain("矿箱");
    expect(logs[0]?.purpose).toBe("world_rumor");
    expect(logs[0]?.npcActorId).toBe("npc-blacksmith");
    expect(logs[0]?.status).toBe("success");
  });

  it("treats an insert conflict as another worker completing the rumor without duplicate audit", async () => {
    const repo = new FakeRumorRepo();
    repo.returnStaleCandidates = true;
    repo.npcSources = [npcSource()];
    const logs: CreateAiCallLogInput[] = [];
    const service = new RumorService(
      repo,
      {
        generateRumor: async () => ({
          message: "村里有人低声谈起：伯林的矿箱又见了底。",
          status: "success",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          fallbackReason: null,
          inputTokens: 80,
          outputTokens: 20,
          latencyMs: 30
        })
      },
      { createAiCallLog: async (input) => void logs.push(input) }
    );

    const first = await service.syncRumors({ now: new Date("2026-07-02T12:00:00.000Z") });
    const second = await service.syncRumors({ now: new Date("2026-07-02T12:01:00.000Z") });

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(repo.inserted).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  it("stores template rumors when AI rejects unsafe output", async () => {
    const repo = new FakeRumorRepo();
    repo.npcSources = [npcSource()];
    const service = new RumorService(repo, {
      generateRumor: async ({ context }) => ({
        message: context.fallbackMessage,
        status: "rejected",
        provider: "template",
        model: "template",
        fallbackReason: "reward_promise",
        inputTokens: 80,
        outputTokens: 20,
        latencyMs: 30
      })
    });

    const created = await service.syncRumors({
      now: new Date("2026-07-02T12:00:00.000Z")
    });

    expect(created[0]?.generatedBy).toBe("template");
    expect(created[0]?.message).toContain("基础铁矿石库存偏低");
  });

  it("prevents duplicate rumors and honors the batch limit", async () => {
    const repo = new FakeRumorRepo();
    repo.rumored.add("npc_event:event-1");
    repo.npcSources = [
      npcSource(),
      npcSource({ sourceId: "event-2", sourceMessage: "玛拉采回了野莓。" }),
      npcSource({ sourceId: "event-3", sourceMessage: "矿工绕开了野兽。" })
    ];
    const service = new RumorService(repo);

    const created = await service.syncRumors({
      now: new Date("2026-07-02T12:00:00.000Z"),
      batchLimit: 1
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.sourceId).toBe("event-2");
    expect(repo.inserted).toHaveLength(1);
  });

  it("does not turn private player action logs into public village rumors", async () => {
    const repo = new FakeRumorRepo();
    repo.gameSources = [
      gameSource(),
      gameSource({
        sourceId: "game-event-2",
        sourceMessage: "你获得了基础铁矿石 x3。",
        tags: ["action.gathering.settle"]
      }),
      gameSource({
        sourceId: "game-event-3",
        sourceMessage: "你开始采集旧矿坑铁矿脉。",
        tags: ["action.gathering.start"]
      })
    ];
    const service = new RumorService(repo);

    const created = await service.syncRumors({
      now: new Date("2026-07-02T12:00:00.000Z")
    });

    expect(created).toEqual([]);
    expect(repo.inserted).toEqual([]);
  });
});

function key(source: RumorSourceRecord) {
  return `${source.sourceType}:${source.sourceId}`;
}
