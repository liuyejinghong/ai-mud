import {
  EQUIPMENT_SLOTS,
  type CurrentActionDto,
  type EquipmentItemDto,
  type GameStateDto,
  type NpcTaskDto
} from "@ai-mud/shared";
import { describe, expect, it } from "vitest";
import {
  selectAvailablePrimaryActions,
  selectContextualObjective,
  selectEquipmentSlots,
  selectRecentLog,
  selectSceneObjects
} from "./gameSelectors";

const baseState: GameStateDto = {
  character: {
    id: "character-1",
    name: "Zichen",
    classId: "ranger",
    level: 1,
    xp: 0,
    hp: 100,
    maxHp: 100,
    currentLocation: "blackpine_outpost",
    position: null,
    injuryUntil: null,
    money: { gold: 0, silver: 0, copper: 0, totalCopper: 0 },
    needs: {
      hunger: {
        current: 5,
        max: 5,
        status: "fed",
        nextMealAt: "2026-07-13T18:00:00.000Z"
      }
    }
  },
  locationTitle: "黑松哨站",
  locationDescription: "哨塔的火盆照亮木墙。",
  map: null,
  inventory: [],
  equipment: [],
  backpackEquipment: [],
  market: null,
  npcTasks: [],
  currentAction: null,
  rumors: [],
  availableActions: ["enter_old_mine", "open_market"],
  log: []
};

const ironOreTask: NpcTaskDto = {
  id: "task-1",
  npcActorId: "npc-blacksmith",
  npcLocation: "blackpine_outpost",
  npcName: "伯林",
  needType: "ore_shortage",
  status: "open",
  title: "炉火缺矿",
  description: "伯林需要基础铁矿石。",
  proposalSource: "ai",
  proposalReason: "矿石库存不足。",
  requestedItem: { itemId: "iron_ore", name: "基础铁矿石", quantity: 3 },
  rewardCopper: { gold: 0, silver: 0, copper: 36, totalCopper: 36 },
  acceptedByCharacterId: null,
  expiresAt: "2026-07-14T08:00:00.000Z",
  createdAt: "2026-07-13T08:00:00.000Z",
  acceptedAt: null,
  completedAt: null
};

const gatheringAction: CurrentActionDto = {
  id: "action-gathering",
  actionType: "gathering",
  status: "active",
  description: "正在采集基础铁矿石",
  startedAt: "2026-07-13T08:00:00.000Z",
  endsAt: "2026-07-13T08:10:00.000Z",
  progressPct: 20,
  cycleProgressPct: 60,
  completedCycles: 0,
  settledCycles: 0,
  plannedCycles: 2,
  expectedYield: [{ itemId: "iron_ore", name: "基础铁矿石", quantity: 4 }],
  combatLog: []
};

const combatAction: CurrentActionDto = {
  ...gatheringAction,
  id: "action-combat",
  actionType: "combat",
  description: "正在与矿道潜伏者战斗",
  cycleProgressPct: null,
  completedCycles: null,
  settledCycles: null,
  plannedCycles: null,
  expectedYield: [],
  combatLog: ["矿道潜伏者发动攻击。"]
};

const trainingSword: EquipmentItemDto = {
  id: "equipment-1",
  slot: "weapon",
  itemKey: "training_sword",
  name: "训练短剑",
  rarity: "common",
  itemLevel: 1,
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
};

describe("selectSceneObjects", () => {
  it("does not invent scene objects from capability flags or anonymous map markers", () => {
    const state: GameStateDto = {
      ...baseState,
      character: {
        ...baseState.character!,
        currentLocation: "old_mine",
        position: { x: 1, y: 1 }
      },
      locationTitle: "旧矿坑",
      map: {
        zoneId: "old_mine",
        width: 2,
        height: 2,
        cells: [{ x: 1, y: 1, markers: ["player", "resource", "encounter"] }]
      },
      availableActions: ["start_gathering", "start_combat", "view_npc_tasks"]
    };

    expect(selectSceneObjects(state)).toEqual([]);
  });

  it("returns only named entities whose DTO location matches the player", () => {
    const state: GameStateDto = {
      ...baseState,
      npcTasks: [
        ironOreTask,
        { ...ironOreTask, id: "task-2", title: "补强城门" },
        {
          ...ironOreTask,
          id: "task-3",
          npcActorId: "npc-miner",
          npcName: "哈德",
          npcLocation: "old_mine"
        }
      ]
    };

    expect(selectSceneObjects(state)).toEqual([
      {
        id: "npc:npc-blacksmith",
        title: "伯林 !",
        body: "有事相托。"
      }
    ]);
  });

  it("can expose a named market only when its entity DTO is present at the settlement", () => {
    const state: GameStateDto = {
      ...baseState,
      market: {
        settlementId: "blackpine_outpost",
        settlementName: "黑松哨站市政集市",
        items: []
      }
    };

    expect(selectSceneObjects(state)).toEqual([
      {
        id: "market:blackpine_outpost",
        title: "黑松哨站市政集市",
        body: "当前没有可交易的货物"
      }
    ]);
  });
});

describe("selectContextualObjective", () => {
  it("guides an idle outpost player toward the Old Mine without inventing an NPC", () => {
    expect(selectContextualObjective(baseState)).toBe(
      "哨站空闲：去旧矿坑寻找基础铁矿石。"
    );
  });

  it("mentions a nearby NPC only when a located entity is present", () => {
    expect(selectContextualObjective({ ...baseState, npcTasks: [ironOreTask] })).toBe(
      "哨站空闲：去旧矿坑寻找基础铁矿石，或与伯林交谈。"
    );
  });

  it("prioritizes municipal relief for a starving player", () => {
    expect(
      selectContextualObjective({
        ...baseState,
        character: {
          ...baseState.character!,
          needs: {
            hunger: {
              current: 0,
              max: 5,
              status: "starving",
              nextMealAt: "2026-07-13T18:00:00.000Z"
            }
          }
        },
        availableActions: ["open_market", "claim_relief"]
      })
    ).toBe("饥饿虚弱：前往市政厅申请一份应急口粮。");
  });

  it("uses expected yield for an active gathering objective", () => {
    expect(
      selectContextualObjective({ ...baseState, currentAction: gatheringAction })
    ).toBe("采集中：下一批基础铁矿石将在本轮结束后入账。");
  });

  it("uses the server combat description while combat is active", () => {
    expect(selectContextualObjective({ ...baseState, currentAction: combatAction })).toBe(
      "战斗中：正在与矿道潜伏者战斗。"
    );
  });

  it("describes a real gathering capability in the Old Mine without naming a resource", () => {
    const state: GameStateDto = {
      ...baseState,
      character: {
        ...baseState.character!,
        currentLocation: "old_mine",
        position: { x: 1, y: 1 }
      },
      locationTitle: "旧矿坑",
      availableActions: ["move", "start_gathering", "return_to_village"]
    };

    expect(selectContextualObjective(state)).toBe(
      "矿坑可采集：此处有可采集的资源，准备好后即可动手。"
    );
  });

  it("falls back to world language when no specific objective is available", () => {
    expect(
      selectContextualObjective({
        ...baseState,
        locationTitle: "灰烬岗哨",
        availableActions: []
      })
    ).toBe("灰烬岗哨暂时没有明显动静，先观察四周。");
  });
});

describe("selectRecentLog", () => {
  it("returns the newest entries in their original chronological order", () => {
    const state: GameStateDto = {
      ...baseState,
      log: Array.from({ length: 5 }, (_, index) => ({
        id: `event-${index + 1}`,
        eventType: "world.broadcast",
        message: `事件 ${index + 1}`,
        createdAt: `2026-07-13T08:0${index}:00.000Z`
      }))
    };

    expect(selectRecentLog(state, 3).map((entry) => entry.id)).toEqual([
      "event-3",
      "event-4",
      "event-5"
    ]);
    expect(state.log.map((entry) => entry.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5"
    ]);
  });

  it("returns no entries for a non-positive limit", () => {
    expect(selectRecentLog({ ...baseState, log: [{ id: "1", eventType: "world.broadcast", message: "一", createdAt: "" }] }, 0))
      .toEqual([]);
    expect(selectRecentLog(baseState, -1)).toEqual([]);
    expect(selectRecentLog({ ...baseState, log: [{ id: "1", eventType: "world.broadcast", message: "一", createdAt: "" }] }, 0.5))
      .toEqual([]);
    expect(selectRecentLog(baseState, Number.NaN)).toEqual([]);
    expect(selectRecentLog(baseState, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("floors positive limits and tolerates limits larger than the log", () => {
    const state: GameStateDto = {
      ...baseState,
      log: [
        { id: "1", eventType: "world.broadcast", message: "一", createdAt: "" },
        { id: "2", eventType: "world.broadcast", message: "二", createdAt: "" },
        { id: "3", eventType: "world.broadcast", message: "三", createdAt: "" }
      ]
    };

    expect(selectRecentLog(state, 2.9).map((entry) => entry.id)).toEqual(["2", "3"]);
    expect(selectRecentLog(state, 99)).toEqual(state.log);
  });
});

describe("selectEquipmentSlots", () => {
  it("covers every shared slot in stable order and maps equipped items", () => {
    const slots = selectEquipmentSlots({ ...baseState, equipment: [trainingSword] });

    expect(slots.map((entry) => entry.slot)).toEqual([...EQUIPMENT_SLOTS]);
    expect(slots).toEqual([
      { slot: "weapon", item: trainingSword },
      { slot: "chest", item: null },
      { slot: "head", item: null },
      { slot: "accessory", item: null }
    ]);
  });
});

describe("selectAvailablePrimaryActions", () => {
  it("maps only server capabilities to stable action ids and player-world labels", () => {
    const state: GameStateDto = {
      ...baseState,
      availableActions: [
        "create_character",
        "enter_corrupt_forest",
        "enter_old_mine",
        "move",
        "gather",
        "start_gathering",
        "start_combat",
        "cancel_action",
        "return_to_village",
        "open_market",
        "repair_equipment",
        "eat_food",
        "view_npc_tasks",
        "claim_relief"
      ]
    };

    expect(selectAvailablePrimaryActions(state)).toEqual([
      { id: "create_character", label: "创建角色" },
      { id: "enter_corrupt_forest", label: "前往腐林" },
      { id: "enter_old_mine", label: "前往旧矿坑" },
      { id: "move", label: "移动" },
      { id: "gather", label: "开始采集" },
      { id: "start_gathering", label: "开始采集" },
      { id: "start_combat", label: "开始战斗" },
      { id: "cancel_action", label: "取消行动" },
      { id: "return_to_village", label: "返回哨站" },
      { id: "open_market", label: "市政集市" },
      { id: "repair_equipment", label: "修理装备" },
      { id: "eat_food", label: "进食" },
      { id: "view_npc_tasks", label: "查看委托" },
      { id: "claim_relief", label: "领取市政救济" }
    ]);
  });

  it("returns no action when the server exposes no capability", () => {
    expect(selectAvailablePrimaryActions({ ...baseState, availableActions: [] })).toEqual([]);
  });
});
