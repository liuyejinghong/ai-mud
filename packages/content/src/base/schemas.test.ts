import { describe, expect, it } from "vitest";
import {
  validateProjectTemplate,
  validateProvisionSeed,
  validateRobotTemplate,
  type ContentProjectTemplate,
  type ContentProvisionSeed,
  type ContentRobotTemplate
} from "./schemas.js";

const validRobot: ContentRobotTemplate = {
  ref: { kind: "robot_template", stableId: "yd-h1", revision: 1 },
  name: "驮运",
  groupId: "transport",
  description: "负责营地内物资转运的驮运机器人。",
  batteryCapacityWh: 20000,
  chargeRateW: 4000,
  workRatePerTick: 1
};

const validProject: ContentProjectTemplate = {
  ref: { kind: "project", stableId: "install-solar-array", revision: 1 },
  name: "安装运抵的太阳能设施",
  description: "把首批货运送达的太阳能设施安装并验收并网。",
  steps: [
    { kind: "site_clearing", groupId: "engineering", workRequired: 40 },
    { kind: "transport", groupId: "transport", workRequired: 60 },
    { kind: "installation", groupId: "engineering", workRequired: 80 },
    { kind: "commissioning", groupId: "survey", workRequired: 20 }
  ],
  inputs: [
    { itemId: "solar_panel_set", quantity: 6 },
    { itemId: "support_frame", quantity: 6 },
    { itemId: "cable", quantity: 2 },
    { itemId: "power_box", quantity: 1 },
    { itemId: "anchor", quantity: 8 }
  ],
  outputFacility: {
    ref: { kind: "facility", stableId: "solar-array-unit", revision: 1 },
    name: "太阳能阵列单元",
    generationWPeak: 5000
  }
};

const validRobots: ContentRobotTemplate[] = [validRobot];
const validProjects: ContentProjectTemplate[] = [validProject];

const validSeed: ContentProvisionSeed = {
  releaseId: "yudian-base-0",
  baseName: "先遣前哨",
  power: { generationWPeak: 15000, storageCapacityWh: 200000, initialStorageWh: 100000 },
  sites: [
    {
      siteKey: "array",
      name: "太阳能阵列",
      state: "built",
      facilityRef: { kind: "facility", stableId: "yudian-array", revision: 1 }
    },
    { siteKey: "site_a", name: "建设位 A", state: "free" }
  ],
  inventory: [
    { itemId: "solar_panel_set", quantity: 6 },
    { itemId: "support_frame", quantity: 6 },
    { itemId: "cable", quantity: 2 },
    { itemId: "power_box", quantity: 1 },
    { itemId: "anchor", quantity: 8 },
    { itemId: "spare_parts", quantity: 30 }
  ],
  devices: [
    { templateStableId: "yd-h1", groupId: "transport", count: 4, initialBatteryWh: 12000 }
  ]
};

describe("validateRobotTemplate", () => {
  it("accepts a fully-formed robot template", () => {
    expect(validateRobotTemplate(validRobot)).toEqual([]);
  });

  it("rejects revision below 1", () => {
    const bad = {
      ...structuredClone(validRobot),
      ref: { kind: "robot_template", stableId: "yd-h1", revision: 0 }
    } satisfies ContentRobotTemplate;
    const errors = validateRobotTemplate(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("; ")).toContain("revision");
  });

  it("rejects negative power fields", () => {
    const bad = { ...structuredClone(validRobot), chargeRateW: -4000 };
    const errors = validateRobotTemplate(bad);
    expect(errors.join("; ")).toContain("chargeRateW");
  });

  it("rejects non-integer battery capacity", () => {
    const bad = { ...structuredClone(validRobot), batteryCapacityWh: 20000.5 };
    const errors = validateRobotTemplate(bad);
    expect(errors.join("; ")).toContain("batteryCapacityWh");
  });

  it("rejects unknown group ids", () => {
    const bad = {
      ...structuredClone(validRobot),
      groupId: "logistics"
    } as unknown as ContentRobotTemplate;
    const errors = validateRobotTemplate(bad);
    expect(errors.join("; ")).toContain("groupId");
  });

  it("rejects robot templates carrying a generation field (no second power source)", () => {
    const bad = {
      ...structuredClone(validRobot),
      generationWPeak: 9000
    } as unknown as ContentRobotTemplate;
    const errors = validateRobotTemplate(bad);
    expect(errors.join("; ")).toContain("generationWPeak");
  });
});

describe("validateProjectTemplate", () => {
  it("accepts a fully-formed project template", () => {
    expect(validateProjectTemplate(validProject)).toEqual([]);
  });

  it("rejects empty steps", () => {
    const bad = { ...structuredClone(validProject), steps: [] };
    const errors = validateProjectTemplate(bad);
    expect(errors.join("; ")).toContain("steps");
  });

  it("rejects a last step that is not commissioning", () => {
    const bad = structuredClone(validProject);
    bad.steps[bad.steps.length - 1] = { kind: "installation", groupId: "engineering", workRequired: 20 };
    const errors = validateProjectTemplate(bad);
    expect(errors.join("; ")).toContain("commissioning");
  });

  it("rejects a first step that is not site_clearing", () => {
    const bad = structuredClone(validProject);
    bad.steps[0] = { kind: "transport", groupId: "transport", workRequired: 40 };
    const errors = validateProjectTemplate(bad);
    expect(errors.join("; ")).toContain("site_clearing");
  });

  it("rejects duplicate input itemIds", () => {
    const bad = structuredClone(validProject);
    bad.inputs.push({ itemId: "anchor", quantity: 1 });
    const errors = validateProjectTemplate(bad);
    expect(errors.join("; ")).toContain("anchor");
  });

  it("rejects non-positive step work", () => {
    const bad = structuredClone(validProject);
    bad.steps[1]!.workRequired = 0;
    const errors = validateProjectTemplate(bad);
    expect(errors.join("; ")).toContain("workRequired");
  });

  it("rejects zero-watt output facilities", () => {
    const bad = structuredClone(validProject);
    bad.outputFacility.generationWPeak = 0;
    const errors = validateProjectTemplate(bad);
    expect(errors.join("; ")).toContain("generationWPeak");
  });
});

describe("validateProvisionSeed", () => {
  it("accepts a seed that covers the first project and references known templates", () => {
    expect(validateProvisionSeed(validSeed, validRobots, validProjects)).toEqual([]);
  });

  it("rejects seed inventory short of the first project inputs", () => {
    const bad = structuredClone(validSeed);
    const anchor = bad.inventory.find((entry) => entry.itemId === "anchor")!;
    anchor.quantity = 7;
    const errors = validateProvisionSeed(bad, validRobots, validProjects);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("; ")).toContain("anchor");
  });

  it("rejects devices referencing undefined robot templates", () => {
    const bad = structuredClone(validSeed);
    bad.devices.push({ templateStableId: "yd-x9", groupId: "survey", count: 1, initialBatteryWh: 1 });
    const errors = validateProvisionSeed(bad, validRobots, validProjects);
    expect(errors.join("; ")).toContain("yd-x9");
  });

  it("rejects device groupIds that contradict the referenced template", () => {
    const bad = structuredClone(validSeed);
    bad.devices[0]!.groupId = "survey";
    const errors = validateProvisionSeed(bad, validRobots, validProjects);
    expect(errors.join("; ")).toContain("groupId");
  });

  it("rejects seeds without a free site", () => {
    const bad = structuredClone(validSeed);
    bad.sites[1]!.state = "built";
    const errors = validateProvisionSeed(bad, validRobots, validProjects);
    expect(errors.join("; ")).toContain("free");
  });

  it("rejects storage seeds exceeding capacity", () => {
    const bad = structuredClone(validSeed);
    bad.power.initialStorageWh = 250000;
    const errors = validateProvisionSeed(bad, validRobots, validProjects);
    expect(errors.join("; ")).toContain("initialStorageWh");
  });

  it("rejects device initial battery above template capacity", () => {
    const bad = structuredClone(validSeed);
    bad.devices[0]!.initialBatteryWh = 21000;
    const errors = validateProvisionSeed(bad, validRobots, validProjects);
    expect(errors.join("; ")).toContain("initialBatteryWh");
  });
});
