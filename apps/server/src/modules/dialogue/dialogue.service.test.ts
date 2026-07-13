import { describe, expect, it } from "vitest";
import type { AiCallLogDto } from "@ai-mud/shared";
import type { AiDialogueReply } from "../ai/ai-orchestrator.js";
import { DialogueService, DialogueServiceError } from "./dialogue.service.js";
import type { InventoryRecord } from "../game/game.repository.js";
import type { VerifiedFavorProfile } from "../npc-memory/npc-memory.service.js";
import type {
  CreateAiCallLogInput,
  CreateDialogueMessageInput,
  DialogueMessageRecord,
  RelationshipRecord,
  UpsertRelationshipInput
} from "./dialogue.repository.js";
import type { NpcTaskRecord } from "../npc-task/npc-task.repository.js";

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
  lastReliefClaimedAt: null,
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
  const systemMemoryEvents: string[] = [];
  const aiContexts: unknown[] = [];
  let latestAiCallLog: AiCallLogDto | null = null;
  let playerCopper = character.copperBalance;
  let npcCopper = npcs[0]!.copperBalance;
  let playerInventory: InventoryRecord[] = [{ itemId: "wild_berry", quantity: 1 }];
  let npcInventory = [{ itemId: "iron_ore", quantity: 5 }];
  let relationship: RelationshipRecord | null = null;
  let verifiedFavorProfile: VerifiedFavorProfile = {
    score: 0,
    recentGrantCount: 0,
    summary: ""
  };
  let resourceTransferCalls = 0;
  let failNextResourceTransfer = false;
  let tasks: NpcTaskRecord[] = [
    {
      id: "task-1",
      npcActorId: "npc-blacksmith",
      needType: "ore_shortage",
      status: "open",
      title: "炉火缺矿",
      description: "伯林缺少基础铁矿石。",
      proposalSource: "template",
      proposalReason: "基础铁矿石不足，修理炉火和补强装备都会被拖慢。",
      requestedItemId: "iron_ore",
      requestedQuantity: 3,
      rewardCopper: 36,
      escrowCopper: 36,
      acceptedByCharacterId: null,
      createdAt: new Date("2026-07-01T11:30:00.000Z"),
      expiresAt: new Date("2026-07-02T11:30:00.000Z"),
      acceptedAt: null,
      completedAt: null,
      cancelledAt: null
    }
  ];

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
      findRelationship: async () => relationship,
      upsertRelationship: async (input: UpsertRelationshipInput) => {
        relationships.push(input);
      },
      createAiCallLog: async (input: CreateAiCallLogInput) => {
        aiLogs.push(input);
      },
      findLatestAiCallLog: async () => latestAiCallLog,
      listAiCallLogs: async () => []
    },
    gameRepo: {
      findCharacterByAccountId: async () => ({ ...character, copperBalance: playerCopper }),
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
    resourceTransferRepo: {
      transferNpcCopperToCharacter: async (input) => {
        resourceTransferCalls += 1;
        if (failNextResourceTransfer || npcCopper < input.copper) {
          failNextResourceTransfer = false;
          return false;
        }
        npcCopper -= input.copper;
        playerCopper += input.copper;
        return true;
      },
      transferNpcItemToCharacter: async (input) => {
        resourceTransferCalls += 1;
        const npcStack = npcInventory.find((item) => item.itemId === input.itemId);
        if (failNextResourceTransfer || !npcStack || npcStack.quantity < input.quantity) {
          failNextResourceTransfer = false;
          return false;
        }
        npcStack.quantity -= input.quantity;
        const playerStack = playerInventory.find((item) => item.itemId === input.itemId);
        if (playerStack) playerStack.quantity += input.quantity;
        else playerInventory.push({ itemId: input.itemId, quantity: input.quantity });
        return true;
      }
    },
    npcRepo: {
      listNpcActors: async () =>
        npcs.map((npc) => (npc.id === "npc-blacksmith" ? { ...npc, copperBalance: npcCopper } : npc)),
      listNpcInventory: async () => npcInventory,
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
    taskRepo: {
      listTasksForCharacter: async () => tasks,
      listCharacterInventory: async () => playerInventory
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
      getDialogueMemoryContext: async () => "记忆碎片：Zichen 曾询问过基础铁矿石短缺。",
      recordSystemMemory: async (input) => {
        systemMemoryEvents.push(input.summary);
      },
      getVerifiedFavorProfile: async () => {
        return verifiedFavorProfile;
      }
    },
    now: () => new Date("2026-07-01T12:00:00.000Z")
  });

  return {
    service,
    messages,
    aiLogs,
    relationships,
    memoryEvents,
    systemMemoryEvents,
    aiContexts,
    setRelationship: (next: RelationshipRecord | null) => {
      relationship = next;
    },
    setNpcInventory: (next: typeof npcInventory) => {
      npcInventory = next;
    },
    setPlayerInventory: (next: InventoryRecord[]) => {
      playerInventory = next;
    },
    setTasks: (next: NpcTaskRecord[]) => {
      tasks = next;
    },
    setVerifiedFavorProfile: (next: VerifiedFavorProfile) => {
      verifiedFavorProfile = next;
    },
    setLatestAiCallLog: (next: AiCallLogDto | null) => {
      latestAiCallLog = next;
    },
    failNextResourceTransfer: () => {
      failNextResourceTransfer = true;
    },
    getResourceTransferCalls: () => resourceTransferCalls,
    getPlayerInventory: () => playerInventory,
    getNpcInventory: () => npcInventory,
    getPlayerCopper: () => playerCopper,
    getNpcCopper: () => npcCopper
  };
}

function relationship(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
  return {
    id: "relationship-1",
    characterId: "character-1",
    npcActorId: "npc-blacksmith",
    familiarity: 2,
    trust: 0,
    lastInteractionAt: new Date("2026-07-01T11:50:00.000Z"),
    shortSummary: "Zichen 经常和伯林交谈。",
    ...overrides
  };
}

describe("DialogueService", () => {
  it("lists only the v0.6.0 dialogue NPCs", async () => {
    const { service } = buildService();

    await expect(service.listDialogueTargets("account-1")).resolves.toEqual([
      expect.objectContaining({
        npcActorId: "npc-blacksmith",
        name: "伯林",
        task: {
          id: "task-1",
          status: "open",
          title: "炉火缺矿",
          requestedItem: { itemId: "iron_ore", name: "基础铁矿石", quantity: 3 },
          playerQuantity: 0,
          rewardCopper: { gold: 0, silver: 0, copper: 36, totalCopper: 36 }
        }
      }),
      expect.objectContaining({
        npcActorId: "npc-officer",
        name: "艾廉",
        task: null
      })
    ]);
  });

  it("does not leak another NPC's open task into the selected nearby dialogue", async () => {
    const { service } = buildService();

    const response = await service.getDialogue("account-1", "npc-officer");

    expect(response.target.npcActorId).toBe("npc-officer");
    expect(response.target.task).toBeNull();
  });

  it("includes the current player quantity for an accepted task", async () => {
    const { service, setPlayerInventory, setTasks } = buildService();
    setPlayerInventory([{ itemId: "iron_ore", quantity: 2 }]);
    setTasks([
      {
        id: "task-accepted",
        npcActorId: "npc-blacksmith",
        needType: "ore_shortage",
        status: "accepted",
        title: "炉火缺矿",
        description: "伯林缺少基础铁矿石。",
        proposalSource: "template",
        proposalReason: "基础铁矿石不足。",
        requestedItemId: "iron_ore",
        requestedQuantity: 3,
        rewardCopper: 36,
        escrowCopper: 36,
        acceptedByCharacterId: "character-1",
        createdAt: new Date("2026-07-01T11:30:00.000Z"),
        expiresAt: new Date("2026-07-02T11:30:00.000Z"),
        acceptedAt: new Date("2026-07-01T11:45:00.000Z"),
        completedAt: null,
        cancelledAt: null
      }
    ]);

    const response = await service.getDialogue("account-1", "npc-blacksmith");

    expect(response.target.task).toEqual(
      expect.objectContaining({
        id: "task-accepted",
        status: "accepted",
        playerQuantity: 2
      })
    );
  });

  it("rejects NPCs outside the allowed dialogue list", async () => {
    const { service } = buildService();

    await expect(
      service.sendDialogueMessage("account-1", "npc-farmer", "聊聊？")
    ).rejects.toBeInstanceOf(DialogueServiceError);
  });

  it("shows a rule-built opener from verified memory before the first dialogue message", async () => {
    const { service, messages, setVerifiedFavorProfile } = buildService();
    setVerifiedFavorProfile({
      score: 2,
      recentGrantCount: 0,
      summary: "可信记忆：Zichen 完成了任务「炉火缺矿」。"
    });

    const response = await service.getDialogue("account-1", "npc-blacksmith");

    expect(messages).toHaveLength(0);
    expect(response.messages).toEqual([
      expect.objectContaining({
        id: "opener:npc-blacksmith:character-1",
        speakerType: "npc",
        message: expect.stringContaining("Zichen 完成了任务「炉火缺矿」")
      })
    ]);
    expect(response.ai.provider).toBe("none");
  });

  it("does not insert an opener when real dialogue history exists", async () => {
    const { service, messages, setVerifiedFavorProfile } = buildService();
    setVerifiedFavorProfile({
      score: 2,
      recentGrantCount: 0,
      summary: "可信记忆：Zichen 完成了任务「炉火缺矿」。"
    });
    messages.push({
      id: "msg-existing",
      accountId: "account-1",
      characterId: "character-1",
      npcActorId: "npc-blacksmith",
      speakerType: "player",
      message: "最近缺什么？",
      safetyFlags: [],
      createdAt: new Date("2026-07-01T11:00:00.000Z")
    });

    const response = await service.getDialogue("account-1", "npc-blacksmith");

    expect(response.messages).toHaveLength(1);
    expect(response.messages[0]?.id).toBe("msg-existing");
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
        memorySummary: "记忆碎片：Zichen 曾询问过基础铁矿石短缺。",
        taskSummary: "真实任务：炉火缺矿，状态可接取，需要 基础铁矿石 x3，托管奖励 36 铜。"
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

    const response = await service.sendDialogueMessage("account-1", "npc-blacksmith", "你怎么看这件事？");

    expect(response.ai.status).toBe("rejected");
    expect(response.ai.fallbackReason).toBe("reward_promise");
    expect(response.messages.at(-1)?.message).not.toContain("金币");
    expect(aiLogs[0]).toMatchObject({ status: "rejected", errorCode: "reward_promise" });
  });

  it("skips free-text AI calls during NPC dialogue cooldown", async () => {
    const { service, aiLogs, aiContexts, messages, setLatestAiCallLog } = buildService();
    setLatestAiCallLog({
      id: "ai-call-previous",
      purpose: "npc_dialogue",
      status: "success",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: 1,
      accountId: "account-1",
      characterId: "character-1",
      npcActorId: "npc-blacksmith",
      inputSummary: "刚刚聊过",
      outputSummary: "刚刚回复过",
      latencyMs: 80,
      inputTokens: 40,
      outputTokens: 20,
      errorCode: null,
      createdAt: "2026-07-01T11:59:58.000Z"
    });

    const response = await service.sendDialogueMessage("account-1", "npc-blacksmith", "最近怎么样？");

    expect(aiContexts).toEqual([]);
    expect(response.ai).toEqual({
      status: "disabled",
      provider: "cooldown",
      model: "npc-dialogue-cooldown",
      fallbackReason: "cooldown"
    });
    expect(response.messages.at(-1)?.message).toBe("我需要想一想，稍后再说。");
    expect(messages).toHaveLength(2);
    expect(aiLogs).toEqual([
      expect.objectContaining({
        purpose: "npc_dialogue",
        status: "disabled",
        inputSummary: "cooldown",
        outputSummary: "我需要想一想，稍后再说。"
      })
    ]);
  });

  it("does not apply dialogue cooldown to deterministic resource requests", async () => {
    const {
      service,
      aiLogs,
      aiContexts,
      setLatestAiCallLog,
      setRelationship,
      getNpcInventory,
      getPlayerInventory
    } = buildService();
    setLatestAiCallLog({
      id: "ai-call-previous",
      purpose: "npc_dialogue",
      status: "success",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: 1,
      accountId: "account-1",
      characterId: "character-1",
      npcActorId: "npc-blacksmith",
      inputSummary: "刚刚聊过",
      outputSummary: "刚刚回复过",
      latencyMs: 80,
      inputTokens: 40,
      outputTokens: 20,
      errorCode: null,
      createdAt: "2026-07-01T11:59:58.000Z"
    });
    setRelationship(relationship({ familiarity: 2, trust: 0 }));

    const response = await service.sendDialogueMessage(
      "account-1",
      "npc-blacksmith",
      "能不能给我一块基础铁矿石？"
    );

    expect(response.ai.provider).toBe("rules");
    expect(response.ai.fallbackReason).toBe("rule_verified");
    expect(getNpcInventory()).toEqual([{ itemId: "iron_ore", quantity: 4 }]);
    expect(getPlayerInventory()).toEqual([
      { itemId: "wild_berry", quantity: 1 },
      { itemId: "iron_ore", quantity: 1 }
    ]);
    expect(aiLogs).toEqual([]);
    expect(aiContexts).toEqual([]);
  });

  it("grants a small requested item only from real NPC inventory and skips AI authority", async () => {
    const {
      service,
      aiLogs,
      aiContexts,
      systemMemoryEvents,
      setRelationship,
      getNpcInventory,
      getPlayerInventory
    } = buildService();
    setRelationship(relationship({ familiarity: 2, trust: 0 }));

    const response = await service.sendDialogueMessage(
      "account-1",
      "npc-blacksmith",
      "能不能给我一块基础铁矿石？"
    );

    expect(response.ai.provider).toBe("rules");
    expect(response.ai.fallbackReason).toBe("rule_verified");
    expect(response.messages.at(-1)?.message).toContain("基础铁矿石 x1");
    expect(getNpcInventory()).toEqual([{ itemId: "iron_ore", quantity: 4 }]);
    expect(getPlayerInventory()).toEqual([
      { itemId: "wild_berry", quantity: 1 },
      { itemId: "iron_ore", quantity: 1 }
    ]);
    expect(aiLogs).toEqual([]);
    expect(aiContexts).toEqual([]);
    expect(systemMemoryEvents[0]).toContain("让渡了 基础铁矿石 x1");
  });

  it("rejects an item grant when the transactional final inventory check fails", async () => {
    const {
      service,
      setRelationship,
      failNextResourceTransfer,
      getNpcInventory,
      getPlayerInventory,
      getResourceTransferCalls
    } = buildService();
    setRelationship(relationship({ familiarity: 2, trust: 0 }));
    failNextResourceTransfer();

    const response = await service.sendDialogueMessage(
      "account-1",
      "npc-blacksmith",
      "能不能给我一块基础铁矿石？"
    );

    expect(response.ai.provider).toBe("rules");
    expect(response.ai.fallbackReason).toBe("insufficient_inventory");
    expect(response.messages.at(-1)?.message).toContain("没有足够的基础铁矿石");
    expect(getResourceTransferCalls()).toBe(1);
    expect(getNpcInventory()).toEqual([{ itemId: "iron_ore", quantity: 5 }]);
    expect(getPlayerInventory()).toEqual([{ itemId: "wild_berry", quantity: 1 }]);
  });

  it("uses the transactional final balance check for NPC copper grants", async () => {
    const {
      service,
      setRelationship,
      failNextResourceTransfer,
      getNpcCopper,
      getPlayerCopper,
      getResourceTransferCalls
    } = buildService();
    setRelationship(relationship({ familiarity: 5, trust: 1 }));
    failNextResourceTransfer();

    const response = await service.sendDialogueMessage(
      "account-1",
      "npc-blacksmith",
      "能不能给我 5 铜币？"
    );

    expect(response.ai.provider).toBe("rules");
    expect(response.ai.fallbackReason).toBe("insufficient_copper");
    expect(getResourceTransferCalls()).toBe(1);
    expect(getNpcCopper()).toBe(120);
    expect(getPlayerCopper()).toBe(120);
  });

  it("uses verified task memory as favor without trusting raw dialogue claims", async () => {
    const {
      service,
      aiLogs,
      aiContexts,
      setRelationship,
      setVerifiedFavorProfile,
      getNpcInventory,
      getPlayerInventory
    } = buildService();
    setRelationship(relationship({ familiarity: 0, trust: 0 }));
    setVerifiedFavorProfile({
      score: 2,
      recentGrantCount: 0,
      summary: "可信记忆：Zichen 完成了任务「炉火缺矿」。"
    });

    const response = await service.sendDialogueMessage(
      "account-1",
      "npc-blacksmith",
      "能不能给我一块基础铁矿石？"
    );

    expect(response.ai.provider).toBe("rules");
    expect(response.ai.fallbackReason).toBe("rule_verified");
    expect(getNpcInventory()).toEqual([{ itemId: "iron_ore", quantity: 4 }]);
    expect(getPlayerInventory()).toEqual([
      { itemId: "wild_berry", quantity: 1 },
      { itemId: "iron_ore", quantity: 1 }
    ]);
    expect(aiLogs).toEqual([]);
    expect(aiContexts).toEqual([]);
  });

  it("refuses repeated resource requests after recent verified grants", async () => {
    const {
      service,
      setRelationship,
      setVerifiedFavorProfile,
      setNpcInventory,
      getNpcInventory,
      getPlayerInventory
    } = buildService();
    setRelationship(relationship({ familiarity: 5, trust: 1 }));
    setVerifiedFavorProfile({
      score: 4,
      recentGrantCount: 2,
      summary: "可信记忆：NPC 基于真实库存让渡了 基础铁矿石 x1。可信记忆：NPC 基于真实库存让渡了 野莓 x1。"
    });
    setNpcInventory([{ itemId: "iron_ore", quantity: 6 }]);

    const response = await service.sendDialogueMessage(
      "account-1",
      "npc-blacksmith",
      "再给我一个铁矿石"
    );

    expect(response.ai.provider).toBe("rules");
    expect(response.ai.fallbackReason).toBe("recently_helped");
    expect(response.messages.at(-1)?.message).toContain("刚帮过你");
    expect(getNpcInventory()).toEqual([{ itemId: "iron_ore", quantity: 6 }]);
    expect(getPlayerInventory()).toEqual([{ itemId: "wild_berry", quantity: 1 }]);
  });

  it("refuses requested items when NPC reserve would be broken", async () => {
    const { service, setRelationship, setNpcInventory, getNpcInventory, getPlayerInventory } =
      buildService();
    setRelationship(relationship({ familiarity: 5, trust: 1 }));
    setNpcInventory([{ itemId: "iron_ore", quantity: 3 }]);

    const response = await service.sendDialogueMessage(
      "account-1",
      "npc-blacksmith",
      "给我一个铁矿石"
    );

    expect(response.ai.provider).toBe("rules");
    expect(response.ai.fallbackReason).toBe("reserve_required");
    expect(response.messages.at(-1)?.message).toContain("还得留着");
    expect(getNpcInventory()).toEqual([{ itemId: "iron_ore", quantity: 3 }]);
    expect(getPlayerInventory()).toEqual([{ itemId: "wild_berry", quantity: 1 }]);
  });
});
