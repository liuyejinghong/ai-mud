import { describe, it, expect } from "vitest";
import { computeLandingMinute } from "../../../modules/industry/landing-rules.js";

describe("Independent R1 assignment acceptance", () => {
  it.each([[false, 1], [false, 2], [true, 1], [true, 2]] as const)(
    "cancelled job must not reuse another job's hauler (reverse=%s, B batches=%s)", (reverse, batches) => {
    // Reachable sequence: A mines a batch, pause A releases H, start B with H,
    // then cancel A. A must wait for an available transporter, not steal H.
    const result = computeLandingMinute({
      simTime: new Date("2026-09-27T08:00:00Z"),
      weatherLight: 1,
      power: {
        solarWPeak: 0, emergencyW: 1000, baseLoadW: 200, chargeLimitW: 400,
        storageWm: 0, storageCapacityWm: 120000, dustLevel: 0,
        genRemainderWm: 0, policy: "production"
      },
      robots: [{
        operatorId: "hauler", deviceDefId: "hauler", groupId: "transport",
        batteryWh: 30, batteryCapacityWh: 120, status: "working",
        currentProjectId: null, currentStepIndex: null, currentExtractionJobId: "B"
      }, ...["builderA", "builderB"].map(id => ({
        operatorId: id, deviceDefId: "builder", groupId: "engineering",
        batteryWh: 100, batteryCapacityWh: 180, status: "idle" as const,
        currentProjectId: null, currentStepIndex: null,
        currentExtractionJobId: id === "builderB" ? "B" : null
      }))],
      robotParams: new Map([["hauler", { workRate: 1, workDrainWh: 3, chargeRateW: 360 }], ["builder", { workRate: 1, workDrainWh: 6, chargeRateW: 0 }]]),
      projects: [], steps: [], manufacturingJobs: [], slots: [],
      extractionJobs: [
        { id: "A", kind: "mine", status: "stopping", nodeId: "iron",
          batchesPlanned: 2, batchesExtracted: 1, batchesDelivered: 0,
          phase: "hauling", phaseWorkDone: 0, builderOperatorIds: ["builderA"],
          haulerOperatorId: "hauler", surveyorOperatorId: null, blockedReason: null },
        { id: "B", kind: "mine", status: "active", nodeId: "copper",
          batchesPlanned: batches, batchesExtracted: 1, batchesDelivered: 0,
          phase: "hauling", phaseWorkDone: 0, builderOperatorIds: ["builderB"],
          haulerOperatorId: "hauler", surveyorOperatorId: null, blockedReason: null }
      ].sort((a, b) => reverse ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id)) as Parameters<typeof computeLandingMinute>[0]["extractionJobs"]
    });
    expect({
      deliveredA: result.extractionUpdates.find(j => j.jobId === "A")?.deliveredOrdinals,
      deliveredB: result.extractionUpdates.find(j => j.jobId === "B")?.deliveredOrdinals,
      battery: result.robotUpdates.find(r => r.operatorId === "hauler")?.batteryWh,
      owner: result.robotUpdates.find(r => r.operatorId === "hauler")?.currentExtractionJobId
    }).toEqual({ deliveredA: [], deliveredB: [1], battery: 27, owner: batches === 1 ? null : "B" });
  });
});
