import { describe, expect, it } from "vitest";
import {
  selectAvailableActions,
  type AvailableActionFacts
} from "./available-actions.js";

describe("available action capability policy", () => {
  it.each([
    {
      name: "village fed healthy",
      facts: {
        location: "village",
        activeAction: null,
        hunger: 5,
        injuryActive: false,
        hasRepairableEquipment: false,
        hasFood: false,
        reliefEligible: false
      },
      expected: ["enter_corrupt_forest", "enter_old_mine", "open_market"]
    },
    {
      name: "village hunger zero",
      facts: {
        location: "village",
        activeAction: null,
        hunger: 0,
        injuryActive: false,
        hasRepairableEquipment: false,
        hasFood: false,
        reliefEligible: false
      },
      expected: ["open_market"]
    },
    {
      name: "village hunger one can still leave while weakened",
      facts: {
        location: "village",
        activeAction: null,
        hunger: 1,
        injuryActive: false,
        hasRepairableEquipment: false,
        hasFood: false,
        reliefEligible: false
      },
      expected: ["enter_corrupt_forest", "enter_old_mine", "open_market"]
    },
    {
      name: "village injured",
      facts: {
        location: "village",
        activeAction: null,
        hunger: 5,
        injuryActive: true,
        hasRepairableEquipment: false,
        hasFood: false,
        reliefEligible: false
      },
      expected: ["open_market"]
    },
    {
      name: "village eligible relief",
      facts: {
        location: "village",
        activeAction: null,
        hunger: 0,
        injuryActive: false,
        hasRepairableEquipment: false,
        hasFood: false,
        reliefEligible: true
      },
      expected: ["open_market", "claim_relief"]
    },
    {
      name: "wild idle",
      facts: {
        location: "wild",
        activeAction: null,
        canGather: true,
        canCombat: true
      },
      expected: ["move", "return_to_village", "start_gathering", "start_combat"]
    },
    {
      name: "wild active gathering",
      facts: {
        location: "wild",
        activeAction: "gathering",
        canGather: true,
        canCombat: false
      },
      expected: ["cancel_action"]
    },
    {
      name: "wild active combat",
      facts: {
        location: "wild",
        activeAction: "combat",
        canGather: false,
        canCombat: true
      },
      expected: ["cancel_action"]
    }
  ] satisfies Array<{
    name: string;
    facts: AvailableActionFacts;
    expected: string[];
  }>)("returns exact actions for $name", ({ facts, expected }) => {
    expect(selectAvailableActions(facts)).toEqual(expected);
  });

  it("keeps compatible village utilities ordered behind market access", () => {
    expect(
      selectAvailableActions({
        location: "village",
        activeAction: null,
        hunger: 0,
        injuryActive: true,
        hasRepairableEquipment: true,
        hasFood: true,
        reliefEligible: false
      })
    ).toEqual(["open_market", "repair_equipment", "eat_food"]);
  });
});
