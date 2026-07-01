import { describe, expect, it } from "vitest";
import {
  CHARACTER_CLASSES,
  GAME_LOCATIONS,
  ITEM_IDS,
  isDirection,
  type CharacterDto,
  type CurrentActionDto,
  type EatFoodRequestDto,
  type EconomySnapshotDto,
  type EquipmentItemDto,
  type GameStateDto,
  type MoneyDto,
  type NeedsDto,
  type AiCallLogDto,
  type NpcDialogueMessageDto,
  type NpcDialogueResponseDto,
  type NpcDialogueTargetDto,
  type NpcSimulationReportDto,
  type NpcSummaryDto,
  type WorldRuntimeStatusDto
} from "./game.js";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("game contract", () => {
  it("defines the first playable character classes and locations", () => {
    expect(CHARACTER_CLASSES.map((entry) => entry.id)).toEqual(["warrior", "ranger", "warlock"]);
    expect(GAME_LOCATIONS.blackpineOutpost).toBe("blackpine_outpost");
    expect(GAME_LOCATIONS.corruptForest).toBe("corrupt_forest");
  });

  it("guards movement directions", () => {
    expect(isDirection("north")).toBe(true);
    expect(isDirection("up")).toBe(false);
  });

  it("exposes v0.6.0 AI dialogue compatibility", () => {
    expect(PRODUCT_VERSION).toBe("0.6.0");
    expect(WORLD_COMPATIBILITY.apiVersion).toBe(9);
    expect(WORLD_COMPATIBILITY.schemaVersion).toBe(8);
    expect(WORLD_COMPATIBILITY.engineVersion).toBe(1);
    expect(WORLD_COMPATIBILITY.rulesetVersion).toBe(7);
    expect(WORLD_COMPATIBILITY.contentVersion).toBe(7);
    expect(WORLD_COMPATIBILITY.promptVersion).toBe(2);
    expect(WORLD_COMPATIBILITY.economyVersion).toBe(2);
  });

  it("includes basic iron ore in the shared item catalog", () => {
    expect(ITEM_IDS).toContain("iron_ore");
  });

  it("describes formatted money values", () => {
    const money: MoneyDto = { gold: 1, silver: 23, copper: 45, totalCopper: 12345 };

    expect(money).toEqual({ gold: 1, silver: 23, copper: 45, totalCopper: 12345 });
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
      itemLevel: 5,
      attackBonus: 2,
      defenseBonus: 0,
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
    const state: Pick<GameStateDto, "availableActions" | "currentAction" | "market" | "equipment"> = {
      availableActions: [
        "move",
        "start_gathering",
        "start_combat",
        "cancel_action",
        "return_to_village",
        "open_market",
        "repair_equipment",
        "eat_food"
      ],
      equipment: [
        {
          id: "equipment-1",
          slot: "weapon",
          itemKey: "training_sword",
          name: "训练短剑",
          itemLevel: 5,
          attackBonus: 2,
          defenseBonus: 0,
          maxDurability: 100,
          currentDurability: 100,
          durabilityPct: 100,
          effectiveStatRatio: 1,
          repairQuote: null
        }
      ],
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
    expect(state.equipment[0]?.durabilityPct).toBe(100);
    expect(state.market?.items[0]?.itemId).toBe("iron_ore");
    expect(state.currentAction).toBeNull();
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
      resourceSnapshots: [
        {
          resourceId: "forest_berry_patch_01",
          name: "野莓灌木",
          remainingCharges: 72
        }
      ],
      health: {
        ok: true,
        issues: []
      }
    };

    expect(report.days).toBe(7);
    expect(report.health.ok).toBe(true);
    expect(report.resourceSnapshots[0]?.remainingCharges).toBeGreaterThan(0);
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
      statusLine: "正在盘点基础铁矿石库存。"
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
      promptVersion: 2,
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
    expect(reply.messages[0]?.speakerType).toBe("npc");
    expect(reply.ai.model).toBe("deepseek-v4-flash");
    expect(audit.status).toBe("success");
    expect(audit.promptVersion).toBe(2);
  });
});
