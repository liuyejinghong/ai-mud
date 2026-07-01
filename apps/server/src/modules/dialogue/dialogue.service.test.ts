import { describe, expect, it } from "vitest";
import type { AiDialogueReply } from "../ai/ai-orchestrator.js";
import { DialogueService, DialogueServiceError } from "./dialogue.service.js";
import type {
  CreateAiCallLogInput,
  CreateDialogueMessageInput,
  DialogueMessageRecord,
  RelationshipRecord,
  UpsertRelationshipInput
} from "./dialogue.repository.js";

const character = {
  id: "character-1",
  accountId: "account-1",
  name: "Zichen",
  classId: "warrior" as const,
  level: 3,
  xp: 0,
  hp: 100,
  maxHp: 100,
  copperBalance: 120,
  hunger: 4,
  lastHungerSettledAt: new Date("2026-07-01T08:00:00.000Z"),
  currentLocation: "blackpine_outpost" as const,
  position: null,
  injuryUntil: null
};

const npcs = [
  {
    id: "npc-blacksmith",
    actorType: "npc" as const,
    npcKey: "blackpine_blacksmith_borin",
    name: "伯林",
    profession: "blacksmith",
    currentLocation: "blackpine_outpost" as const,
    position: null,
    copperBalance: 120,
    hunger: 4,
    lastHungerSettledAt: new Date("2026-07-01T08:00:00.000Z"),
    status: "active"
  },
  {
    id: "npc-officer",
    actorType: "npc" as const,
    npcKey: "blackpine_officer_elian",
    name: "艾廉",
    profession: "municipal_officer",
    currentLocation: "blackpine_outpost" as const,
    position: null,
    copperBalance: 80,
    hunger: 5,
    lastHungerSettledAt: new Date("2026-07-01T08:00:00.000Z"),
    status: "active"
  },
  {
    id: "npc-farmer",
    actorType: "npc" as const,
    npcKey: "blackpine_farmer_mara",
    name: "玛拉",
    profession: "farmer",
    currentLocation: "blackpine_outpost" as const,
    position: null,
    copperBalance: 40,
    hunger: 5,
    lastHungerSettledAt: new Date("2026-07-01T08:00:00.000Z"),
    status: "active"
  }
];

function buildService(reply: Partial<AiDialogueReply> = {}) {
  const messages: DialogueMessageRecord[] = [];
  const aiLogs: CreateAiCallLogInput[] = [];
  const relationships: UpsertRelationshipInput[] = [];
  const memoryEvents: string[] = [];
  const aiContexts: unknown[] = [];

  const service = new DialogueService({
    dialogueRepo: {
      listDialogueMessages: async () => messages,
      createDialogueMessage: async (input: CreateDialogueMessageInput) => {
        const record: DialogueMessageRecord = {
          id: `msg-${messages.length + 1}`,
          accountId: input.accountId,
          characterId: input.characterId,
          npcActorId: input.npcActorId,
          speakerType: input.speakerType,
          message: input.message,
          safetyFlags: input.safetyFlags,
          createdAt: input.createdAt ?? new Date("2026-07-01T12:00:00.000Z")
        };
        messages.push(record);
        return record;
      },
      findRelationship: async () => null as RelationshipRecord | null,
      upsertRelationship: async (input: UpsertRelationshipInput) => {
        relationships.push(input);
      },
      createAiCallLog: async (input: CreateAiCallLogInput) => {
        aiLogs.push(input);
      },
      listAiCallLogs: async () => []
    },
    gameRepo: {
      findCharacterByAccountId: async () => character,
      listMarketInventory: async () => [
        {
          id: "market-ore",
          settlementId: "blackpine_outpost",
          itemId: "iron_ore",
          quantity: 4,
          targetQuantity: 80,
          baseBuyPriceCopper: 18,
          baseSellPriceCopper: 30
        }
      ]
    },
    npcRepo: {
      listNpcActors: async () => npcs,
      listNpcInventory: async () => [{ itemId: "iron_ore", quantity: 2 }],
      findActiveNpcAction: async () => null,
      listNpcEvents: async () => [
        {
          id: "event-1",
          actorId: "npc-blacksmith",
          message: "伯林抱怨基础铁矿石库存太少。",
          createdAt: new Date("2026-07-01T11:00:00.000Z")
        }
      ]
    },
    ai: {
      replyToNpcDialogue: async (input) => {
        aiContexts.push(input.npcContext);
        return {
          reply: "基础铁矿石快见底了。你若去旧矿脉，带些回来。",
          status: "success",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          fallbackReason: null,
          inputTokens: 100,
          outputTokens: 40,
          latencyMs: 30,
          ...reply
        };
      }
    },
    memory: {
      recordDialogueExchange: async (input) => {
        memoryEvents.push(
          `${input.playerName}:${input.playerMessage}:${input.npcReply}:${input.sourceIds?.join(",") ?? ""}`
        );
      },
      getDialogueMemoryContext: async () => "记忆碎片：Zichen 曾询问过基础铁矿石短缺。"
    },
    now: () => new Date("2026-07-01T12:00:00.000Z")
  });

  return { service, messages, aiLogs, relationships, memoryEvents, aiContexts };
}

describe("DialogueService", () => {
  it("lists only the v0.6.0 dialogue NPCs", async () => {
    const { service } = buildService();

    await expect(service.listDialogueTargets("account-1")).resolves.toEqual([
      expect.objectContaining({ npcActorId: "npc-blacksmith", name: "伯林" }),
      expect.objectContaining({ npcActorId: "npc-officer", name: "艾廉" })
    ]);
  });

  it("rejects NPCs outside the allowed dialogue list", async () => {
    const { service } = buildService();

    await expect(
      service.sendDialogueMessage("account-1", "npc-farmer", "聊聊？")
    ).rejects.toBeInstanceOf(DialogueServiceError);
  });

  it("rejects overlong player input", async () => {
    const { service } = buildService();

    await expect(
      service.sendDialogueMessage("account-1", "npc-blacksmith", "矿".repeat(301))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("stores player and NPC messages and writes an AI audit log", async () => {
    const { service, messages, aiLogs, relationships, memoryEvents, aiContexts } = buildService();

    const response = await service.sendDialogueMessage("account-1", "npc-blacksmith", "最近缺什么？");

    expect(response.messages.map((entry) => entry.speakerType)).toEqual(["player", "npc"]);
    expect(messages).toHaveLength(2);
    expect(aiLogs).toEqual([
      expect.objectContaining({
        status: "success",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        npcActorId: "npc-blacksmith"
      })
    ]);
    expect(relationships).toEqual([
      expect.objectContaining({
        characterId: "character-1",
        npcActorId: "npc-blacksmith",
        familiarityDelta: 1
      })
    ]);
    expect(memoryEvents).toEqual([
      expect.stringContaining("Zichen:最近缺什么？:基础铁矿石快见底了")
    ]);
    expect(memoryEvents[0]).toContain("msg-1,msg-2");
    expect(aiContexts[0]).toMatchObject({
      npc: expect.objectContaining({
        memorySummary: "记忆碎片：Zichen 曾询问过基础铁矿石短缺。"
      })
    });
  });

  it("stores fallback replies without exposing unsafe provider output", async () => {
    const { service, aiLogs } = buildService({
      reply: "炉火还没灭。矿石带来再说。",
      status: "rejected",
      provider: "template",
      model: "template",
      fallbackReason: "reward_promise"
    });

    const response = await service.sendDialogueMessage("account-1", "npc-blacksmith", "给我金币");

    expect(response.ai.status).toBe("rejected");
    expect(response.ai.fallbackReason).toBe("reward_promise");
    expect(response.messages.at(-1)?.message).not.toContain("金币");
    expect(aiLogs[0]).toMatchObject({ status: "rejected", errorCode: "reward_promise" });
  });
});
