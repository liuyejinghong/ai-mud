import type { GameStateDto } from "@ai-mud/shared";

type ActiveAction = "gathering" | "combat" | null;

export type AvailableActionFacts =
  | {
      location: "village";
      activeAction: ActiveAction;
      hunger: number;
      injuryActive: boolean;
      hasRepairableEquipment: boolean;
      hasFood: boolean;
      reliefEligible: boolean;
    }
  | {
      location: "wild";
      activeAction: ActiveAction;
      canGather: boolean;
      canCombat: boolean;
    };

export function selectAvailableActions(
  facts: AvailableActionFacts
): GameStateDto["availableActions"] {
  if (facts.activeAction !== null) return ["cancel_action"];

  if (facts.location === "wild") {
    const actions: GameStateDto["availableActions"] = ["move", "return_to_village"];
    if (facts.canGather) actions.push("start_gathering");
    if (facts.canCombat) actions.push("start_combat");
    return actions;
  }

  const recoveryBlocked = facts.hunger === 0 || facts.injuryActive;
  const actions: GameStateDto["availableActions"] = recoveryBlocked
    ? ["open_market"]
    : ["enter_corrupt_forest", "enter_old_mine", "open_market"];

  if (facts.hasRepairableEquipment) actions.push("repair_equipment");
  if (facts.hunger < 5 && facts.hasFood) actions.push("eat_food");
  if (facts.reliefEligible) actions.push("claim_relief");

  return actions;
}
