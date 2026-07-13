import {
  EQUIPMENT_SLOTS,
  type EquipmentItemDto,
  type EquipmentSlot,
  type GameLogEntryDto,
  type GameStateDto
} from "@ai-mud/shared";

type AvailableActionId = GameStateDto["availableActions"][number];

export interface SceneObject {
  id: string;
  title: string;
  body: string;
}

export interface EquipmentSlotSelection {
  slot: EquipmentSlot;
  item: EquipmentItemDto | null;
}

export interface PrimaryAction {
  id: AvailableActionId;
  label: string;
}

const ACTION_LABELS = {
  create_character: "创建角色",
  enter_corrupt_forest: "前往腐林",
  enter_old_mine: "前往旧矿坑",
  move: "移动",
  gather: "开始采集",
  start_gathering: "开始采集",
  start_combat: "开始战斗",
  cancel_action: "取消行动",
  return_to_village: "返回哨站",
  open_market: "前往市政集市",
  repair_equipment: "修理装备",
  eat_food: "进食",
  view_npc_tasks: "查看委托",
  claim_relief: "申请市政救济"
} satisfies Record<AvailableActionId, string>;

function asSentence(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[。！？]$/u.test(trimmed) ? trimmed : `${trimmed}。`;
}

function isAvailable(state: GameStateDto, ...actions: AvailableActionId[]) {
  return actions.some((action) => state.availableActions.includes(action));
}

export function selectSceneObjects(state: GameStateDto): SceneObject[] {
  const currentLocation = state.character?.currentLocation;
  if (!currentLocation) return [];

  const objects: SceneObject[] = [];
  const seenNpcIds = new Set<string>();

  for (const task of state.npcTasks) {
    const npcId = task.npcActorId.trim();
    const npcName = task.npcName.trim();
    if (
      task.npcLocation !== currentLocation ||
      !npcId ||
      !npcName ||
      seenNpcIds.has(npcId)
    ) {
      continue;
    }

    seenNpcIds.add(npcId);
    objects.push({
      id: `npc:${npcId}`,
      title: task.status === "open" ? `${npcName} !` : npcName,
      body: task.status === "open" ? "有事相托。" : "可与其交谈。"
    });
  }

  if (
    state.market &&
    state.market.settlementId === currentLocation &&
    state.market.settlementName.trim()
  ) {
    objects.push({
      id: `market:${state.market.settlementId}`,
      title: state.market.settlementName,
      body:
        state.market.items.length > 0
          ? `${state.market.items.length} 种货物可供交易`
          : "当前没有可交易的货物"
    });
  }

  return objects;
}

export function selectContextualObjective(state: GameStateDto): string {
  const action = state.currentAction;

  if (action?.actionType === "combat") {
    const description = asSentence(action.description);
    return description ? `战斗中：${description}` : "战斗中：交锋仍在继续。";
  }

  if (action?.actionType === "gathering") {
    const yieldNames = [
      ...new Set(
        action.expectedYield
          .map((item) => item.name.trim())
          .filter((name) => name.length > 0)
      )
    ];
    if (yieldNames.length > 0) {
      return `采集中：下一批${yieldNames.join("、")}将在本轮结束后入账。`;
    }

    const description = asSentence(action.description);
    return description ? `采集中：${description}` : "采集中：等待本轮采集结束。";
  }

  if (isAvailable(state, "claim_relief")) {
    return "饥饿虚弱：前往市政厅申请一份应急口粮。";
  }

  if (
    state.character?.currentLocation === "blackpine_outpost" &&
    isAvailable(state, "enter_old_mine")
  ) {
    const nearbyNpc = selectSceneObjects(state).find((object) => object.id.startsWith("npc:"));
    const nearbyNpcName = nearbyNpc?.title.replace(/\s+!$/u, "");
    return nearbyNpc
      ? `哨站空闲：去旧矿坑寻找基础铁矿石，或与${nearbyNpcName}交谈。`
      : "哨站空闲：去旧矿坑寻找基础铁矿石。";
  }

  if (
    state.character?.currentLocation === "old_mine" &&
    isAvailable(state, "gather", "start_gathering")
  ) {
    return "矿坑可采集：此处有可采集的资源，准备好后即可动手。";
  }

  if (isAvailable(state, "gather", "start_gathering")) {
    return "附近有可采集的资源，准备好后即可动手。";
  }

  if (isAvailable(state, "start_combat")) {
    return "此处可以迎战，准备好后发起战斗。";
  }

  const locationTitle = state.locationTitle.trim() || "此处";
  return `${locationTitle}暂时没有明显动静，先观察四周。`;
}

export function selectRecentLog(
  state: GameStateDto,
  limit: number
): GameLogEntryDto[] {
  const count = Math.floor(limit);
  if (!Number.isFinite(count) || count <= 0) return [];
  return state.log.slice(-count);
}

export function selectEquipmentSlots(state: GameStateDto): EquipmentSlotSelection[] {
  return EQUIPMENT_SLOTS.map((slot) => ({
    slot,
    item: state.equipment.find((item) => item.slot === slot) ?? null
  }));
}

export function selectAvailablePrimaryActions(state: GameStateDto): PrimaryAction[] {
  return state.availableActions.map((id) => ({ id, label: ACTION_LABELS[id] }));
}
