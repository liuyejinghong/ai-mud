import type { CharacterClassId } from "@ai-mud/shared";

export interface GatheringPlanInput {
  baseCycleSeconds: number;
  classId: CharacterClassId;
  agility: number;
  plannedMinutes: 10 | 30 | 120;
  remainingCharges: number;
}

export interface GatheringPlan {
  cycleMs: number;
  plannedCycles: number;
}

export interface GatheringSettlementInput {
  startedAtMs: number;
  nowMs: number;
  cycleMs: number;
  plannedCycles: number;
  settledCycles: number;
  remainingCharges: number;
}

export interface GatheringSettlement {
  completedCycles: number;
  newCyclesToSettle: number;
  isComplete: boolean;
  cycleProgressPct: number;
  overallProgressPct: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function calculateGatheringPlan(input: GatheringPlanInput): GatheringPlan {
  const classMultiplier = input.classId === "ranger" ? 0.9 : 1;
  const agilityBonus = clamp((input.agility - 10) * 0.02, 0, 0.3);
  const cycleMs = Math.max(
    10_000,
    Math.round(input.baseCycleSeconds * 1000 * classMultiplier * (1 - agilityBonus))
  );
  const requestedCycles = Math.max(1, Math.floor((input.plannedMinutes * 60_000) / cycleMs));

  return {
    cycleMs,
    plannedCycles: Math.min(requestedCycles, input.remainingCharges)
  };
}

export function calculateGatheringSettlement(
  input: GatheringSettlementInput
): GatheringSettlement {
  const elapsedMs = Math.max(0, input.nowMs - input.startedAtMs);
  const plannedCycles = Math.max(1, input.plannedCycles);
  const availableCycles = Math.max(0, input.remainingCharges);
  const completedCycles = Math.min(
    plannedCycles,
    availableCycles,
    Math.floor(elapsedMs / input.cycleMs)
  );
  const newCyclesToSettle = Math.max(0, completedCycles - input.settledCycles);
  const cycleRemainder = elapsedMs % input.cycleMs;
  const cycleProgressPct =
    completedCycles >= plannedCycles ? 100 : Math.round((cycleRemainder / input.cycleMs) * 100);
  const overallProgressPct = Math.round((completedCycles / plannedCycles) * 100);

  return {
    completedCycles,
    newCyclesToSettle,
    isComplete: completedCycles >= plannedCycles || completedCycles >= availableCycles,
    cycleProgressPct,
    overallProgressPct
  };
}
