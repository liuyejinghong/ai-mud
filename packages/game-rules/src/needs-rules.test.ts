import { describe, expect, it } from "vitest";
import {
  calculateMunicipalReliefEligibility,
  type MunicipalReliefEligibilityInput
} from "./needs-rules.js";

const NOW = new Date("2026-07-13T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60_000;

function eligibleInput(
  overrides: Partial<MunicipalReliefEligibilityInput> = {}
): MunicipalReliefEligibilityInput {
  return {
    inVillage: true,
    hunger: 1,
    foodQuantity: 0,
    copperBalance: 4,
    cheapestFoodPriceCopper: 5,
    lastClaimedAt: new Date(NOW.getTime() - DAY_MS),
    now: NOW,
    ...overrides
  };
}

describe("municipal food relief eligibility", () => {
  it("only grants relief for a verified hunger soft-lock", () => {
    expect(calculateMunicipalReliefEligibility(eligibleInput())).toEqual({ eligible: true });
  });

  it.each([
    {
      name: "outside the village",
      overrides: { inVillage: false },
      reason: "not_in_village"
    },
    {
      name: "not hungry enough",
      overrides: { hunger: 2 },
      reason: "not_hungry"
    },
    {
      name: "carrying food",
      overrides: { foodQuantity: 1 },
      reason: "has_food"
    },
    {
      name: "able to afford the cheapest food",
      overrides: { copperBalance: 5 },
      reason: "can_afford_food"
    },
    {
      name: "inside the claim cooldown",
      overrides: { lastClaimedAt: new Date(NOW.getTime() - DAY_MS + 1) },
      reason: "cooldown"
    }
  ] as const)("rejects a claimant $name", ({ overrides, reason }) => {
    expect(calculateMunicipalReliefEligibility(eligibleInput(overrides))).toEqual({
      eligible: false,
      reason
    });
  });

  it("treats an unavailable ordinary-food price as unable to afford food", () => {
    expect(
      calculateMunicipalReliefEligibility(
        eligibleInput({ copperBalance: 10_000, cheapestFoodPriceCopper: null })
      )
    ).toEqual({ eligible: true });
  });

  it("allows a first claim without a cooldown record", () => {
    expect(calculateMunicipalReliefEligibility(eligibleInput({ lastClaimedAt: null }))).toEqual({
      eligible: true
    });
  });

  it("allows a new claim exactly 24 hours after the previous claim", () => {
    expect(
      calculateMunicipalReliefEligibility(
        eligibleInput({ lastClaimedAt: new Date(NOW.getTime() - DAY_MS) })
      )
    ).toEqual({ eligible: true });
  });

  it.each([
    {
      name: "village jurisdiction before every claimant-state check",
      overrides: {
        inVillage: false,
        hunger: 5,
        foodQuantity: 2,
        copperBalance: 100,
        lastClaimedAt: NOW
      },
      reason: "not_in_village"
    },
    {
      name: "hunger before food, affordability, and cooldown",
      overrides: {
        hunger: 2,
        foodQuantity: 2,
        copperBalance: 100,
        lastClaimedAt: NOW
      },
      reason: "not_hungry"
    },
    {
      name: "food possession before affordability and cooldown",
      overrides: {
        foodQuantity: 2,
        copperBalance: 100,
        lastClaimedAt: NOW
      },
      reason: "has_food"
    },
    {
      name: "affordability before cooldown",
      overrides: {
        copperBalance: 100,
        lastClaimedAt: NOW
      },
      reason: "can_afford_food"
    }
  ] as const)("prioritizes $name", ({ overrides, reason }) => {
    expect(calculateMunicipalReliefEligibility(eligibleInput(overrides))).toEqual({
      eligible: false,
      reason
    });
  });
});
