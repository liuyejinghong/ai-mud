import type { GridPositionDto, ItemId, NpcProfession } from "@ai-mud/shared";

export interface NpcTravelStepInput {
  current: GridPositionDto;
  target: GridPositionDto;
}

export function nextNpcTravelStep(input: NpcTravelStepInput): GridPositionDto {
  if (input.current.x !== input.target.x) {
    return {
      x: input.current.x + Math.sign(input.target.x - input.current.x),
      y: input.current.y
    };
  }

  if (input.current.y !== input.target.y) {
    return {
      x: input.current.x,
      y: input.current.y + Math.sign(input.target.y - input.current.y)
    };
  }

  return { ...input.current };
}

export interface NpcWorkIntentInput {
  profession: NpcProfession;
  workResourceId: string | null;
  producesItemId: ItemId | null;
}

export type NpcWorkIntent =
  | { intent: "gather"; resourceId: string; itemId: ItemId }
  | { intent: "idle" };

export function chooseNpcWorkIntent(input: NpcWorkIntentInput): NpcWorkIntent {
  if (
    (input.profession === "farmer" || input.profession === "miner") &&
    input.workResourceId &&
    input.producesItemId
  ) {
    return {
      intent: "gather",
      resourceId: input.workResourceId,
      itemId: input.producesItemId
    };
  }

  return { intent: "idle" };
}

export interface NpcMealIntentInput {
  hunger: number;
  inventory: Array<{ itemId: ItemId; quantity: number }>;
  marketFoodStock: number;
}

export type NpcMealIntent =
  | { intent: "none" }
  | { intent: "eat_food"; itemId: ItemId }
  | { intent: "buy_food" }
  | { intent: "food_unavailable" };

export function chooseNpcMealIntent(input: NpcMealIntentInput): NpcMealIntent {
  if (input.hunger > 2) return { intent: "none" };

  const food = input.inventory.find((item) => item.quantity > 0);
  if (food) return { intent: "eat_food", itemId: food.itemId };

  if (input.marketFoodStock > 0) return { intent: "buy_food" };

  return { intent: "food_unavailable" };
}

export function calculateNpcWagePayment(input: {
  requestedCopper: number;
  treasuryCopper: number;
}) {
  const requestedCopper = Math.max(0, Math.floor(input.requestedCopper));
  const treasuryCopper = Math.max(0, Math.floor(input.treasuryCopper));
  const paidCopper = Math.min(requestedCopper, treasuryCopper);

  return {
    paidCopper,
    shortfallCopper: requestedCopper - paidCopper
  };
}

export interface NpcSimulationHealthInput {
  balances: number[];
  stockQuantities: number[];
  resourceCharges: number[];
  activeActions: Array<{
    id: string;
    endsAtMs: number;
    nowMs: number;
  }>;
}

export function validateNpcSimulationHealth(input: NpcSimulationHealthInput) {
  const issues: string[] = [];

  if (input.balances.some((balance) => balance < 0)) issues.push("negative_balance");
  if (input.stockQuantities.some((quantity) => quantity < 0)) issues.push("negative_stock");
  if (input.resourceCharges.some((charges) => charges < 0)) {
    issues.push("negative_resource_charge");
  }

  for (const action of input.activeActions) {
    if (action.endsAtMs < action.nowMs) {
      issues.push(`overdue_active_action:${action.id}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}
