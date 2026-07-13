import { describe, expect, it } from "vitest";
import {
  CHARACTER_CLASSES,
  GAME_LOCATIONS,
  isDirection,
  type CharacterDto,
  type CurrentActionDto,
  type EatFoodRequestDto,
  type EconomySnapshotDto,
  type EquipmentItemDto,
  type GameStateDto,
  type GameSyncResponseDto,
  type ChatMessageDto,
  type PresenceDto,
  type LeaderboardEntryDto,
  type MoneyDto,
  type NeedsDto,
  type AiCallStatus,
  type AiLayerStatusDto,
  type AiCallLogDto,
  type AiPurposeStatusDto,
  type NpcDialogueMessageDto,
  type NpcDialogueResponseDto,
  type NpcDialogueTargetDto,
  type NpcMemoryEntryDto,
  type NpcMemoryFragmentDto,
  type NpcSimulationReportDto,
  type NpcSummaryDto,
  type NpcTaskDto,
  type WorldRumorDto,
  type WorldRuntimeStatusDto
} from "./game.js";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("game contract", () => {
  it("defines the first playable character classes and locations", () => {
    expect(CHARACTER_CLASSES.map((entry) => entry.id)).toEqual(["warrior", "ranger", "warlock"]);
    expect(GAME_LOCATIONS.blackpineOutpost).toBe("blackpine_outpost");
    expect(GAME_LOCATIONS.corruptForest).toBe("corrupt_forest");
    expect(GAME_LOCATIONS.oldMine).toBe("old_mine");
    expect(GAME_LOCATIONS.ashWatch).toBe("ash_watch");
  });

  it("guards movement directions", () => {
    expect(isDirection("north")).toBe(true);
    expect(isDirection("up")).toBe(false);
  });

  it("exposes v0.10.5 world health compatibility", () => {
    expect(PRODUCT_VERSION).toBe("0.10.5");
    expect(WORLD_COMPATIBILITY.apiVersion).toBe(37);
    expect(WORLD_COMPATIBILITY.schemaVersion).toBe(24);
    expect(WORLD_COMPATIBILITY.engineVersion).toBe(2);
    expect(WORLD_COMPATIBILITY.rulesetVersion).toBe(15);
    expect(WORLD_COMPATIBILITY.contentVersion).toBe(12);
    expect(WORLD_COMPATIBILITY.promptVersion).toBe(8);
    expect(WORLD_COMPATIBILITY.economyVersion).toBe(4);
  });

  it("keeps item ids as DTO strings instead of a shared content catalog", () => {
    const inventory: CurrentActionDto["expectedYield"][number] = {
      itemId: "unknown_future_content_item",
      name: "未同步物品",
      quantity: 1
    };

    expect(inventory.itemId).toBe("unknown_future_content_item");
  });

  it("describes formatted money values", () => {
    const money: MoneyDto = { gold: 1, silver: 23, copper: 45, totalCopper: 12345 };

    expect(money).toEqual({ gold: 1, silver: 23, copper: 45, totalCopper: 12345 });
  });

  it("describes incremental game sync responses", () => {
    const chat: ChatMessageDto = {
      id: "chat-1",
      characterId: "character-2",
      characterName: "Borin",
      channel: "lobby",
      body: "有人在矿坑捡到蓝装了。",
      createdAt: "2026-07-02T00:00:01.000Z"
    };
    const presence: PresenceDto = {
      accountId: "account-2",
      characterId: "character-2",
      characterName: "Borin",
      currentLocation: "blackpine_outpost",
      lastSeenAt: "2026-07-02T00:00:02.000Z"
    };
    const leaderboard: LeaderboardEntryDto = {
      rank: 1,
      characterId: "character-2",
      characterName: "Borin",
      level: 8,
      xp: 120,
      wealthCopper: 3500
    };
    const response: GameSyncResponseDto = {
      stateVersion: 12,
      state: null,
      nextCursor: 12,
      events: [
        {
          id: 12,
          eventType: "inventory.changed",
          stateDirty: true,
          payload: { itemId: "iron_ore" },
          source: "server",
          createdAt: "2026-07-02T00:00:00.000Z"
        }
      ],
      chat: [chat],
      presence: [presence],
      leaderboards: {
        level: [leaderboard],
        wealth: [leaderboard]
      }
    };

    expect(response.events[0]?.stateDirty).toBe(true);
    expect(response.state).toBeNull();
    expect(response.chat?.[0]?.channel).toBe("lobby");
    expect(response.presence?.[0]?.currentLocation).toBe("blackpine_outpost");
    expect(response.leaderboards?.level?.[0]?.rank).toBe(1);
  });

  it("describes player hunger needs", () => {
    const needs: NeedsDto = {
      hunger: {
        current: 5,
        max: 5,
        status: "fed",
        nextMealAt: "2026-07-01T10:00:00.000Z"
      }
    };
    const character: Pick<CharacterDto, "needs"> = { needs };

    expect(character.needs.hunger.current).toBe(5);
    expect(character.needs.hunger.status).toBe("fed");
  });

  it("describes current gathering action progress", () => {
    const action: CurrentActionDto = {
      id: "action-1",
      actionType: "gathering",
      status: "active",
      description: "正在采集野莓灌木",
      startedAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-07-01T00:10:00.000Z",
      progressPct: 50,
      cycleProgressPct: 25,
      completedCycles: 5,
      settledCycles: 4,
      plannedCycles: 10,
      expectedYield: [{ itemId: "wild_berry", name: "野莓", quantity: 10 }],
      combatLog: []
    };

    expect(action.actionType).toBe("gathering");
    expect(action.completedCycles).toBe(5);
  });

  it("describes equipped items with durability and repair quotes", () => {
    const equipment: EquipmentItemDto = {
      id: "equipment-1",
      slot: "weapon",
      itemKey: "training_sword",
      name: "训练短剑",
      rarity: "common",
      itemLevel: 5,
      attackBonus: 2,
      defenseBonus: 0,
      agilityBonus: 0,
      maxHpBonus: 0,
      affixes: [],
      maxDurability: 100,
      currentDurability: 60,
      durabilityPct: 60,
      effectiveStatRatio: 1,
      repairQuote: {
        copperCost: { gold: 0, silver: 0, copper: 50, totalCopper: 50 },
        ironOreCost: 1
      }
    };

    expect(equipment.slot).toBe("weapon");
    expect(equipment.repairQuote?.ironOreCost).toBe(1);
  });

  it("allows v0.4.2 action commands in game state", () => {
    const state: Pick<
      GameStateDto,
      | "availableActions"
      | "currentAction"
      | "market"
      | "equipment"
      | "backpackEquipment"
      | "npcTasks"
      | "rumors"
    > = {
      rumors: [],
      availableActions: [
        "move",
        "enter_old_mine",
        "start_gathering",
        "start_combat",
        "cancel_action",
        "return_to_village",
        "open_market",
        "repair_equipment",
        "eat_food",
        "view_npc_tasks",
        "claim_relief"
      ],
      npcTasks: [],
      equipment: [
        {
          id: "equipment-1",
          slot: "weapon",
          itemKey: "training_sword",
          name: "训练短剑",
          rarity: "common",
          itemLevel: 5,
          attackBonus: 2,
          defenseBonus: 0,
          agilityBonus: 0,
          maxHpBonus: 0,
          affixes: [],
          maxDurability: 100,
          currentDurability: 100,
          durabilityPct: 100,
          effectiveStatRatio: 1,
          repairQuote: null
        }
      ],
      backpackEquipment: [],
      currentAction: null,
      market: {
        settlementId: "blackpine_outpost",
        settlementName: "黑松哨站市政集市",
        items: [
          {
            itemId: "iron_ore",
            name: "基础铁矿石",
            category: "ore",
            itemLevel: 1,
            stockQuantity: 12,
            playerQuantity: 3,
            buyPrice: { gold: 0, silver: 0, copper: 30, totalCopper: 30 },
            sellPrice: { gold: 0, silver: 0, copper: 18, totalCopper: 18 },
            buyTax: { gold: 0, silver: 0, copper: 2, totalCopper: 2 },
            sellTax: { gold: 0, silver: 0, copper: 1, totalCopper: 1 }
          }
        ]
      }
    };

    expect(state.availableActions).toContain("start_gathering");
    expect(state.availableActions).toContain("open_market");
    expect(state.availableActions).toContain("repair_equipment");
    expect(state.availableActions).toContain("eat_food");
    expect(state.availableActions).toContain("view_npc_tasks");
    expect(state.availableActions).toContain("claim_relief");
    expect(state.equipment[0]?.durabilityPct).toBe(100);
    expect(state.market?.items[0]?.itemId).toBe("iron_ore");
    expect(state.currentAction).toBeNull();
  });

  it("describes public world rumors with nullable source and expiry", () => {
    const rumor: WorldRumorDto = {
      id: "rumor-1",
      sourceType: "system",
      sourceId: null,
      audience: "public",
      message: "村里有人低声谈起：旧矿道外围又传来铁器敲击声。",
      tags: ["旧矿道"],
      generatedBy: "template",
      createdAt: "2026-07-02T10:00:00.000Z",
      expiresAt: null
    };

    expect(rumor.audience).toBe("public");
    expect(rumor.sourceId).toBeNull();
    expect(rumor.expiresAt).toBeNull();
  });

  it("describes manual food consumption requests", () => {
    const request: EatFoodRequestDto = { itemId: "wild_berry" };

    expect(request.itemId).toBe("wild_berry");
  });

  it("describes the admin economy snapshot", () => {
    const snapshot: EconomySnapshotDto = {
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
          actorId: "actor-farmer",
          actorType: "npc",
          actorName: "玛拉",
          characterId: null,
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

    expect(snapshot.taxSummary.taxCopper).toBe(9);
    expect(snapshot.marketItems[0]?.targetQuantity).toBe(20);
    expect(snapshot.recentTransactions[0]?.transactionType).toBe("sell");
    expect(snapshot.recentTransactions[0]?.actorType).toBe("npc");
    expect(snapshot.recentTransactions[0]?.characterId).toBeNull();
  });

  it("describes long-term NPC world actors", () => {
    const npc: NpcSummaryDto = {
      id: "actor-farmer",
      actorType: "npc",
      npcKey: "blackpine_farmer_mara",
      name: "玛拉",
      profession: "farmer",
      currentLocation: "corrupt_forest",
      position: { x: 1, y: 3 },
      money: { gold: 0, silver: 1, copper: 25, totalCopper: 125 },
      hunger: {
        current: 4,
        max: 5,
        status: "fed",
        nextMealAt: "2026-07-01T18:00:00.000Z"
      },
      currentAction: {
        actionType: "gathering",
        description: "正在采集野莓"
      },
      inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 3 }],
      recentEvents: [
        {
          id: "event-1",
          message: "玛拉开始采集野莓。",
          createdAt: "2026-07-01T12:00:00.000Z"
        }
      ]
    };

    expect(npc.actorType).toBe("npc");
    expect(npc.profession).toBe("farmer");
    expect(npc.currentAction?.actionType).toBe("gathering");
  });

  it("describes NPC simulation reports from real world records", () => {
    const report: NpcSimulationReportDto = {
      startedAt: "2026-07-01T00:00:00.000Z",
      endedAt: "2026-07-08T00:00:00.000Z",
      days: 7,
      settlementId: "blackpine_outpost",
      treasury: { gold: 0, silver: 80, copper: 0, totalCopper: 8000 },
      npcCount: 4,
      actionCount: 96,
      marketTransactionCount: 18,
      metrics: {
        minNpcHunger: 3,
        hungryNpcCount: 0,
        starvingNpcCount: 0,
        totalNpcCopper: 420,
        marketStockQuantity: 88,
        activeActionCount: 2,
        completedActionCount: 94,
        idleNpcCount: 2,
        idleRate: 0.5,
        fedNpcCount: 4,
        resourceStartCharges: 120,
        resourceEndCharges: 88,
        resourceDelta: -32,
        marketTransactionsPerDay: 2.5,
        taskTriggerRate: 3.35,
        hungerDistribution: {
          starving: 0,
          hungry: 0,
          fed: 4
        }
      },
      resourceSnapshots: [
        {
          zoneId: "corrupt_forest",
          resourceId: "forest_berry_patch_01",
          name: "野莓灌木",
          remainingCharges: 72
        }
      ],
      mapResourceSnapshots: [
        {
          zoneId: "old_mine",
          resourceCount: 2,
          depletedResourceCount: 0,
          refreshedAt: "2026-07-08T00:00:00.000Z"
        }
      ],
      health: {
        ok: true,
        issues: []
      }
    };

    expect(report.days).toBe(7);
    expect(report.health.ok).toBe(true);
    expect(report.metrics.starvingNpcCount).toBe(0);
    expect(report.metrics.idleRate).toBe(0.5);
    expect(report.metrics.marketTransactionsPerDay).toBeGreaterThan(0);
    expect(report.resourceSnapshots[0]?.remainingCharges).toBeGreaterThan(0);
    expect(report.mapResourceSnapshots[0]?.depletedResourceCount).toBe(0);
  });

  it("describes NPC world runtime status", () => {
    const status: WorldRuntimeStatusDto = {
      key: "npc_world",
      generatedAt: "2026-07-01T12:00:00.000Z",
      lastSettledAt: "2026-07-01T11:59:00.000Z",
      nextTickAt: "2026-07-01T12:00:00.000Z",
      leaseOwner: null,
      leaseUntil: null
    };

    expect(status.key).toBe("npc_world");
    expect(status.nextTickAt).toBe("2026-07-01T12:00:00.000Z");
  });

  it("describes NPC dialogue targets, messages, responses, and AI audit logs", () => {
    const target: NpcDialogueTargetDto = {
      npcActorId: "npc-blackpine-blacksmith-borin",
      npcKey: "blackpine_blacksmith_borin",
      name: "伯林",
      profession: "blacksmith",
      currentLocation: "blackpine_outpost",
      statusLine: "正在盘点基础铁矿石库存。",
      hasTask: true,
      taskStatus: "open",
      taskTitle: "炉火缺矿"
    };
    const message: NpcDialogueMessageDto = {
      id: "msg-1",
      npcActorId: target.npcActorId,
      speakerType: "npc",
      message: "炉火还没灭。你要修装备，先把矿石带来。",
      createdAt: "2026-07-01T12:00:00.000Z"
    };
    const reply: NpcDialogueResponseDto = {
      target,
      messages: [message],
      ai: {
        status: "success",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        fallbackReason: null
      }
    };
    const audit: AiCallLogDto = {
      id: "ai-call-1",
      purpose: "npc_dialogue",
      status: "success",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: 4,
      accountId: "account-1",
      characterId: "character-1",
      npcActorId: target.npcActorId,
      inputSummary: "玩家询问铁矿石是否短缺。",
      outputSummary: "伯林要求玩家带来基础铁矿石。",
      latencyMs: 320,
      inputTokens: 220,
      outputTokens: 80,
      errorCode: null,
      createdAt: "2026-07-01T12:00:01.000Z"
    };

    expect(reply.target.name).toBe("伯林");
    expect(reply.target.hasTask).toBe(true);
    expect(reply.target.taskTitle).toBe("炉火缺矿");
    expect(reply.messages[0]?.speakerType).toBe("npc");
    expect(reply.ai.model).toBe("deepseek-v4-flash");
    expect(audit.status).toBe("success");
    expect(audit.promptVersion).toBe(4);

    const taskCopyAudit: AiCallLogDto = {
      ...audit,
      id: "ai-call-2",
      purpose: "npc_task_copy",
      accountId: null,
      characterId: null,
      inputSummary: "伯林缺少基础铁矿石。",
      outputSummary: "炉火缺矿。"
    };
    expect(taskCopyAudit.purpose).toBe("npc_task_copy");

    const memoryCompressionAudit: AiCallLogDto = {
      ...audit,
      id: "ai-call-3",
      purpose: "npc_memory_compression",
      accountId: null,
      characterId: null,
      inputSummary: "伯林压缩 3 条 conversation 记忆。",
      outputSummary: "伯林记得阿岚多次提到基础铁矿石。"
    };
    expect(memoryCompressionAudit.purpose).toBe("npc_memory_compression");
  });

  it("describes AI layer purpose status for admin governance", () => {
    const cooldownStatus: AiCallStatus = "disabled";
    expect(cooldownStatus).toBe("disabled");

    const purpose: AiPurposeStatusDto = {
      purpose: "npc_dialogue",
      authorityClass: "presentation",
      enabled: true,
      mutatesWorldState: false,
      maxOutputTokens: 180,
      cooldownMs: 5000,
      fallbackRequired: true,
      promptVersion: 1,
      callCount24h: 3,
      successCount24h: 1,
      fallbackCount24h: 1,
      rejectedCount24h: 0,
      errorCount24h: 0,
      disabledCount24h: 1,
      totalInputTokens24h: 80,
      totalOutputTokens24h: 40,
      averageLatencyMs24h: 120,
      latestStatus: "disabled",
      latestAt: "2026-07-02T12:00:00.000Z"
    };
    const status: AiLayerStatusDto = {
      providerEnabled: true,
      providerName: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: 8,
      budget: {
        dailyTokenBudget: 1000,
        usedTokens24h: 120,
        remainingTokens24h: 880,
        fallbackCount24h: 1,
        latestFailureReason: null,
        exhausted: false
      },
      purposes: [purpose]
    };

    expect(status.purposes[0]?.mutatesWorldState).toBe(false);
    expect(status.purposes[0]?.disabledCount24h).toBe(1);
    expect(status.purposes[0]?.latestStatus).toBe("disabled");
    expect(status.budget.remainingTokens24h).toBe(880);
  });

  it("describes NPC memory entries and compressed fragments", () => {
    const entry: NpcMemoryEntryDto = {
      id: "mem-1",
      npcActorId: "npc-blacksmith",
      characterId: "char-1",
      sourceType: "dialogue",
      memoryKind: "conversation",
      evidenceLevel: "dialogue_claim",
      sourceIds: ["msg-1", "msg-2"],
      importance: 2,
      summary: "游侠阿岚告诉伯林自己正在寻找基础铁矿石。",
      occurredAt: "2026-07-02T08:00:00.000Z",
      compressedAt: null
    };

    const fragment: NpcMemoryFragmentDto = {
      id: "frag-1",
      npcActorId: "npc-blacksmith",
      characterId: "char-1",
      memoryKind: "conversation",
      evidenceLevel: "dialogue_claim",
      importance: 2,
      summary: "阿岚多次询问铁矿石和修理装备。",
      firstOccurredAt: "2026-07-02T08:00:00.000Z",
      lastOccurredAt: "2026-07-02T09:00:00.000Z",
      sourceEntryIds: ["mem-1"],
      compressionLevel: 1
    };

    expect(entry.memoryKind).toBe("conversation");
    expect(entry.sourceType).toBe("dialogue");
    expect(entry.evidenceLevel).toBe("dialogue_claim");
    expect(fragment.compressionLevel).toBe(1);
  });

  it("describes NPC demand tasks with escrowed copper rewards", () => {
    const task: NpcTaskDto = {
      id: "task-1",
      npcActorId: "npc-blacksmith",
      npcLocation: "blackpine_outpost",
      npcName: "伯林",
      needType: "ore_shortage",
      status: "open",
      title: "炉火缺矿",
      description: "伯林需要基础铁矿石维持修理炉火。",
      proposalSource: "ai",
      proposalReason: "没有矿石，哨站的修理活会拖到深夜。",
      requestedItem: { itemId: "iron_ore", name: "基础铁矿石", quantity: 3 },
      rewardCopper: { gold: 0, silver: 0, copper: 36, totalCopper: 36 },
      acceptedByCharacterId: null,
      expiresAt: "2026-07-03T08:00:00.000Z",
      createdAt: "2026-07-02T08:00:00.000Z",
      acceptedAt: null,
      completedAt: null
    };

    expect(task.needType).toBe("ore_shortage");
    expect(task.npcLocation).toBe("blackpine_outpost");
    expect(task.proposalSource).toBe("ai");
    expect(task.proposalReason).toContain("修理活");
    expect(task.requestedItem.itemId).toBe("iron_ore");
    expect(task.rewardCopper.totalCopper).toBe(36);
  });
});
