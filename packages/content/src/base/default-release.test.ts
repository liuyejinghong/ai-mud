import { describe, expect, it } from "vitest";
import {
  BASE_PROJECT_TEMPLATES,
  BASE_PROVISION_SEED,
  BASE_ROBOT_TEMPLATES,
  RELEASE_ID,
  DEFAULT_BASE_CONTENT_RELEASE,
  BASE_ITEM_INFO
} from "./default-release.js";
import {
  validateProjectTemplate,
  validateProvisionSeed,
  validateRobotTemplate
} from "./schemas.js";

const robotByStableId = new Map(BASE_ROBOT_TEMPLATES.map((robot) => [robot.ref.stableId, robot]));

describe("yudian-base-0 default release", () => {
  it("carries the frozen release id consistently", () => {
    expect(RELEASE_ID).toBe("yudian-base-0");
    expect(DEFAULT_BASE_CONTENT_RELEASE.releaseId).toBe("yudian-base-0");
    expect(BASE_PROVISION_SEED.releaseId).toBe("yudian-base-0");
  });

  it("passes every content-layer validation predicate", () => {
    for (const robot of BASE_ROBOT_TEMPLATES) {
      expect(validateRobotTemplate(robot), robot.ref.stableId).toEqual([]);
    }
    for (const project of BASE_PROJECT_TEMPLATES) {
      expect(validateProjectTemplate(project), project.ref.stableId).toEqual([]);
    }
    expect(
      validateProvisionSeed(BASE_PROVISION_SEED, BASE_ROBOT_TEMPLATES, BASE_PROJECT_TEMPLATES)
    ).toEqual([]);
  });

  it("locks the three robot templates to the fixture values", () => {
    expect(BASE_ROBOT_TEMPLATES.map((robot) => robot.ref.stableId)).toEqual([
      "yd-h1",
      "yd-e1",
      "yd-s1"
    ]);
    expect(robotByStableId.get("yd-h1")).toMatchObject({
      name: "驮运",
      groupId: "transport",
      batteryCapacityWh: 20000,
      chargeRateW: 4000,
      workRatePerTick: 1,
      ref: { kind: "robot_template", stableId: "yd-h1", revision: 1 }
    });
    expect(robotByStableId.get("yd-e1")).toMatchObject({
      name: "筑垒",
      groupId: "engineering",
      batteryCapacityWh: 30000,
      chargeRateW: 6000,
      workRatePerTick: 1
    });
    expect(robotByStableId.get("yd-s1")).toMatchObject({
      name: "望山",
      groupId: "survey",
      batteryCapacityWh: 10000,
      chargeRateW: 2000,
      workRatePerTick: 1
    });
  });

  it("locks the first project steps, inputs, and output facility", () => {
    expect(BASE_PROJECT_TEMPLATES).toHaveLength(2);
    const project = BASE_PROJECT_TEMPLATES[0]!;
    expect(project.ref).toEqual({
      kind: "project",
      stableId: "install-solar-array",
      revision: 1
    });
    expect(project.name).toBe("安装运抵的太阳能设施");
    expect(project.steps.map((step) => step.kind)).toEqual([
      "site_clearing",
      "transport",
      "installation",
      "commissioning"
    ]);
    expect(project.steps.map((step) => step.groupId)).toEqual([
      "engineering",
      "transport",
      "engineering",
      "survey"
    ]);
    expect(project.steps.map((step) => step.workRequired)).toEqual([40, 60, 80, 20]);
    expect(project.inputs).toEqual([
      { itemId: "solar_panel_set", quantity: 6 },
      { itemId: "support_frame", quantity: 6 },
      { itemId: "cable", quantity: 2 },
      { itemId: "power_box", quantity: 1 },
      { itemId: "anchor", quantity: 8 }
    ]);
    expect(project.outputFacility).toEqual({
      ref: { kind: "facility", stableId: "solar-array-unit", revision: 1 },
      name: "太阳能阵列单元",
      generationWPeak: 5000
    });
  });

  it("locks the second project: transport-heavy so manufactured crew matters (评审 D008)", () => {
    const project = BASE_PROJECT_TEMPLATES[1]!;
    expect(project.ref).toEqual({
      kind: "project",
      stableId: "install-second-array",
      revision: 1
    });
    expect(project.steps.map((step) => step.groupId)).toEqual([
      "engineering",
      "transport",
      "engineering",
      "survey"
    ]);
    expect(project.steps.map((step) => step.workRequired)).toEqual([40, 100, 80, 30]);
    // 材料全部可经补给站外购：接单→账款→材料→工程的闭环（账款沉淀口）
    expect(project.inputs.every((input) => input.itemId in BASE_ITEM_INFO)).toBe(true);
    expect(project.outputFacility).toMatchObject({
      ref: { stableId: "solar-array-unit", revision: 1 },
      generationWPeak: 5000
    });
  });

  it("locks the power seed to initial array 15000W and storage 200000/100000Wh", () => {
    expect(BASE_PROVISION_SEED.power).toEqual({
      generationWPeak: 15000,
      storageCapacityWh: 200000,
      initialStorageWh: 100000
    });
  });

  it("starts with exactly 12 devices (4/5/3) charged to 60% of template capacity", () => {
    const devices = BASE_PROVISION_SEED.devices;
    expect(devices.map((device) => device.count)).toEqual([4, 5, 3]);
    const total = devices.reduce((sum, device) => sum + device.count, 0);
    expect(total).toBe(12);
    for (const device of devices) {
      const template = robotByStableId.get(device.templateStableId)!;
      expect(device.groupId).toBe(template.groupId);
      expect(device.initialBatteryWh).toBe(Math.floor(template.batteryCapacityWh * 0.6));
    }
    expect(devices.map((device) => device.initialBatteryWh)).toEqual([12000, 18000, 6000]);
  });

  it("keeps a single generation source: only seed power and project outputFacility declare watts", () => {
    const seedGeneration = BASE_PROVISION_SEED.power.generationWPeak;
    expect(seedGeneration).toBe(15000);
    for (const robot of BASE_ROBOT_TEMPLATES) {
      expect(Object.keys(robot)).not.toContain("generationWPeak");
      expect(JSON.stringify(robot)).not.toContain("generationWPeak");
    }
    const project = BASE_PROJECT_TEMPLATES[0]!;
    expect(JSON.stringify(project.steps)).not.toContain("generation");
    expect(project.outputFacility.generationWPeak).toBe(5000);
    for (const site of BASE_PROVISION_SEED.sites) {
      expect(site.facilityRef ? JSON.stringify(site.facilityRef) : "").not.toContain("generation");
    }
  });

  it("seeds five built sites plus the first free build slot", () => {
    const sites = BASE_PROVISION_SEED.sites;
    expect(sites.map((site) => site.siteKey)).toEqual([
      "array",
      "storage",
      "warehouse",
      "maintenance",
      "charging",
      "site_a",
      "site_b"
    ]);
    const freeSites = sites.filter((site) => site.state === "free");
    expect(freeSites.map((site) => site.siteKey)).toEqual(["site_a", "site_b"]);
    for (const site of sites) {
      if (site.state === "built") {
        expect(site.facilityRef).toMatchObject({ kind: "facility", revision: 1 });
        expect(site.facilityRef!.stableId).toMatch(/^yudian-/);
      }
    }
  });

  it("seeds inventory covering the first project inputs plus spare parts", () => {
    const inventory = new Map(
      BASE_PROVISION_SEED.inventory.map((entry) => [entry.itemId, entry.quantity] as const)
    );
    expect(BASE_PROVISION_SEED.inventory).toHaveLength(6);
    const project = BASE_PROJECT_TEMPLATES[0]!;
    for (const input of project.inputs) {
      expect(inventory.get(input.itemId) ?? 0).toBeGreaterThanOrEqual(input.quantity);
      expect(inventory.get(input.itemId)).toBe(input.quantity);
    }
    expect(inventory.get("spare_parts")).toBe(30);
  });
});
