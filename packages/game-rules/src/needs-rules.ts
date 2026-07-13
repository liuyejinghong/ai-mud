import type { HungerStatus, ItemId } from "@ai-mud/shared";

export const MAX_HUNGER = 5;
export const MEAL_HOURS = [8, 18] as const;
export const MAX_HUNGER_SETTLEMENT_MEALS = 6;

export interface HungerInventoryItem {
  itemId: ItemId;
  quantity: number;
}

export interface HungerFoodDefinition {
  itemId: ItemId;
  itemLevel: number;
  satietyRestore: number;
}

export interface HungerSettlementInput {
  currentHunger: number;
  lastSettledAt: Date;
  now: Date;
  inventory: HungerInventoryItem[];
  foods: HungerFoodDefinition[];
}

export interface HungerSettlementResult {
  hunger: number;
  consumed: HungerInventoryItem[];
  missedMeals: number;
  nextMealAt: Date;
  injured: boolean;
}

export interface MunicipalReliefEligibilityInput {
  inVillage: boolean;
  hunger: number;
  foodQuantity: number;
  copperBalance: number;
  cheapestFoodPriceCopper: number | null;
  lastClaimedAt: Date | null;
  now: Date;
}

export type MunicipalReliefIneligibilityReason =
  | "not_hungry"
  | "has_food"
  | "can_afford_food"
  | "cooldown"
  | "not_in_village";

export type MunicipalReliefEligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: MunicipalReliefIneligibilityReason };

const MUNICIPAL_RELIEF_COOLDOWN_MS = 24 * 60 * 60_000;

function clampHunger(value: number) {
  return Math.min(MAX_HUNGER, Math.max(0, Math.floor(value)));
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addConsumed(consumed: HungerInventoryItem[], itemId: ItemId) {
  const existing = consumed.find((item) => item.itemId === itemId);
  if (existing) {
    existing.quantity += 1;
    return;
  }
  consumed.push({ itemId, quantity: 1 });
}

export function calculateHungerStatus(current: number): HungerStatus {
  const hunger = clampHunger(current);
  if (hunger <= 1) return "starving";
  if (hunger <= 2) return "hungry";
  return "fed";
}

export function calculateMunicipalReliefEligibility(
  input: MunicipalReliefEligibilityInput
): MunicipalReliefEligibilityResult {
  if (!input.inVillage) return { eligible: false, reason: "not_in_village" };
  if (input.hunger > 1) return { eligible: false, reason: "not_hungry" };
  if (input.foodQuantity !== 0) return { eligible: false, reason: "has_food" };
  if (
    input.cheapestFoodPriceCopper !== null &&
    input.copperBalance >= input.cheapestFoodPriceCopper
  ) {
    return { eligible: false, reason: "can_afford_food" };
  }
  if (
    input.lastClaimedAt !== null &&
    input.now.getTime() - input.lastClaimedAt.getTime() < MUNICIPAL_RELIEF_COOLDOWN_MS
  ) {
    return { eligible: false, reason: "cooldown" };
  }
  return { eligible: true };
}

export function calculateNextMealAt(now: Date): Date {
  const base = startOfUtcDay(now);
  for (const hour of MEAL_HOURS) {
    const mealAt = new Date(base.getTime() + hour * 60 * 60_000);
    if (mealAt.getTime() > now.getTime()) return mealAt;
  }
  return new Date(base.getTime() + (24 + MEAL_HOURS[0]) * 60 * 60_000);
}

export function countUnsettledMeals(lastSettledAt: Date, now: Date): number {
  if (now.getTime() <= lastSettledAt.getTime()) return 0;

  let count = 0;
  const cursor = startOfUtcDay(lastSettledAt);
  const end = now.getTime();

  while (cursor.getTime() <= end && count < MAX_HUNGER_SETTLEMENT_MEALS) {
    for (const hour of MEAL_HOURS) {
      const mealAt = cursor.getTime() + hour * 60 * 60_000;
      if (mealAt > lastSettledAt.getTime() && mealAt <= end) {
        count += 1;
        if (count >= MAX_HUNGER_SETTLEMENT_MEALS) return count;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
}

export function selectAutoEatFood(
  inventory: HungerInventoryItem[],
  foods: HungerFoodDefinition[]
): ItemId | null {
  const candidates = foods
    .filter((food) => food.satietyRestore > 0)
    .filter((food) => (inventory.find((item) => item.itemId === food.itemId)?.quantity ?? 0) > 0)
    .sort((left, right) => left.itemLevel - right.itemLevel || left.itemId.localeCompare(right.itemId));

  return candidates[0]?.itemId ?? null;
}

export function settleHunger(input: HungerSettlementInput): HungerSettlementResult {
  const missedMeals = countUnsettledMeals(input.lastSettledAt, input.now);
  let hunger = clampHunger(input.currentHunger);
  const inventory = input.inventory.map((item) => ({ ...item }));
  const consumed: HungerInventoryItem[] = [];

  for (let index = 0; index < missedMeals; index += 1) {
    const foodId = selectAutoEatFood(inventory, input.foods);
    if (foodId) {
      const stack = inventory.find((item) => item.itemId === foodId);
      if (stack) stack.quantity -= 1;
      addConsumed(consumed, foodId);
      continue;
    }

    hunger = clampHunger(hunger - 1);
  }

  return {
    hunger,
    consumed,
    missedMeals,
    nextMealAt: calculateNextMealAt(input.now),
    injured: hunger === 0
  };
}

export function calculateHungerCombatMultiplier(current: number) {
  const hunger = clampHunger(current);
  if (hunger <= 0) return 0.5;
  if (hunger <= 1) return 0.8;
  return 1;
}
