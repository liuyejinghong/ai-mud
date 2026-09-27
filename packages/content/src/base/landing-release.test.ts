// R1 C 包验收：landing release 黄金数值 + 材料来源可达性（05 §5 C 条件）。
// 每项非初始必需材料至少一条可达来源；每个新 UI 可展示条目有真实能力消费者。
import { describe, expect, it } from "vitest";
import {
  LANDING_BASE_CONTENT_RELEASE,
  LANDING_PROVISION_SEED,
  LANDING_RECIPE_TEMPLATES,
  LANDING_ROBOT_TEMPLATES
} from "./landing-release.js";
import {
  validateItemNames,
  validateOrderTemplate,
  validateProvisionSeed,
  validateProjectTemplate,
  validateRecipeTemplate,
  validateRobotTemplate
} from "./schemas.js";

function assertReleaseValid() {
  const failures: string[] = [];
  for (const robot of LANDING_BASE_CONTENT_RELEASE.robots) {
    failures.push(...validateRobotTemplate(robot));
  }
  for (const project of LANDING_BASE_CONTENT_RELEASE.projects) {
    failures.push(...validateProjectTemplate(project));
  }
  for (const recipe of LANDING_BASE_CONTENT_RELEASE.recipes) {
    failures.push(...validateRecipeTemplate(recipe));
  }
  for (const order of LANDING_BASE_CONTENT_RELEASE.orderTemplates) {
    failures.push(...validateOrderTemplate(order));
  }
  failures.push(
    ...validateItemNames(
      LANDING_BASE_CONTENT_RELEASE.itemNames,
      LANDING_BASE_CONTENT_RELEASE.provisionSeed,
      LANDING_BASE_CONTENT_RELEASE.projects
    )
  );
  failures.push(
    ...validateProvisionSeed(
      LANDING_BASE_CONTENT_RELEASE.provisionSeed,
      LANDING_BASE_CONTENT_RELEASE.robots,
      LANDING_BASE_CONTENT_RELEASE.projects,
      LANDING_BASE_CONTENT_RELEASE.itemNames
    )
  );
  expect(failures).toEqual([]);
}

describe("landing release golden numbers", () => {
  it("passes all content validators", () => {
    assertReleaseValid();
  });

  it("keeps the approved seed manifest", () => {
    const seed = LANDING_PROVISION_SEED;
    expect(seed.power).toEqual({
      generationWPeak: 0,
      storageCapacityWh: 2000,
      initialStorageWh: 1000,
      emergencyGenerationW: 1000,
      baseLoadW: 200,
      chargeLimitW: 400,
      initialDustLevel: 0
    });
    expect(seed.initialCredits).toBe(0);
    // 常设设施全部未建成：唯一 built 站点是着陆器。
    const builtSites = seed.sites.filter((site) => site.state === "built");
    expect(builtSites.map((site) => site.siteKey)).toEqual(["lander"]);
    // 六个套件安装位 + 四个扩建位。
    expect(seed.sites.filter((site) => site.state === "free").length).toBe(10);
    // 六种套件各 1；控制器/光伏片 12/12；备件 6；原料 0。
    const inventory = new Map(seed.inventory.map((entry) => [entry.itemId, entry.quantity]));
    for (const kit of [
      "solar_kit",
      "warehouse_kit",
      "storage_kit",
      "charging_kit",
      "processing_kit",
      "maintenance_kit"
    ]) {
      expect(inventory.get(kit)).toBe(1);
    }
    expect(inventory.get("controller")).toBe(12);
    expect(inventory.get("pv_cell")).toBe(12);
    expect(inventory.get("spare_part")).toBe(6);
    for (const ore of ["iron_ore", "copper_ore", "iron_ingot", "copper_ingot", "structural_frame", "wire_cable"]) {
      expect(inventory.has(ore)).toBe(false);
    }
    // 12 台设备：驮运 4 / 筑垒 5 / 望山 3，初始 60% 电。
    expect(seed.devices).toEqual([
      { templateStableId: "landing-hauler", groupId: "transport", count: 4, initialBatteryWh: 72 },
      { templateStableId: "landing-builder", groupId: "engineering", count: 5, initialBatteryWh: 108 },
      { templateStableId: "landing-surveyor", groupId: "survey", count: 3, initialBatteryWh: 48 }
    ]);
    // 铁铜各一处，各 200 单位。
    expect(seed.resourceNodes).toEqual([
      { nodeKey: "iron_north", name: "北坡磁异常", itemId: "iron_ore", initialQuantity: 200 },
      { nodeKey: "copper_ridge", name: "脊线蓝绿氧化带", itemId: "copper_ore", initialQuantity: 200 }
    ]);
  });

  it("keeps per-model battery / drain / charge profile (no legacy 500Wh)", () => {
    const byId = new Map(LANDING_ROBOT_TEMPLATES.map((robot) => [robot.ref.stableId, robot]));
    expect(byId.get("landing-hauler")).toMatchObject({
      batteryCapacityWh: 120,
      chargeRateW: 360,
      workDrainWhPerTick: 3
    });
    expect(byId.get("landing-builder")).toMatchObject({
      batteryCapacityWh: 180,
      chargeRateW: 600,
      workDrainWhPerTick: 6
    });
    expect(byId.get("landing-surveyor")).toMatchObject({
      batteryCapacityWh: 80,
      chargeRateW: 240,
      workDrainWhPerTick: 2
    });
    for (const robot of LANDING_ROBOT_TEMPLATES) {
      expect(robot.workDrainWhPerTick).toBeLessThan(500);
    }
  });

  it("keeps the approved recipe table (inputs/outputs/ratedW/minutes)", () => {
    const byId = new Map(LANDING_RECIPE_TEMPLATES.map((recipe) => [recipe.ref.stableId, recipe]));
    const expectations: Array<[string, unknown]> = [
      [
        "landing-smelt-iron",
        { inputs: [{ itemId: "iron_ore", quantity: 2 }], ratedW: 2000, workMinutesPerBatch: 1, requiredCapability: "processing" }
      ],
      [
        "landing-smelt-copper",
        { inputs: [{ itemId: "copper_ore", quantity: 2 }], ratedW: 2000, workMinutesPerBatch: 1, requiredCapability: "processing" }
      ],
      [
        "landing-make-structural",
        { inputs: [{ itemId: "iron_ingot", quantity: 2 }], ratedW: 2000, workMinutesPerBatch: 1, requiredCapability: "processing" }
      ],
      [
        "landing-make-cable",
        { inputs: [{ itemId: "copper_ingot", quantity: 1 }], ratedW: 2000, workMinutesPerBatch: 1, requiredCapability: "processing" }
      ],
      [
        "landing-make-spares",
        {
          inputs: [
            { itemId: "iron_ingot", quantity: 1 },
            { itemId: "copper_ingot", quantity: 1 }
          ],
          ratedW: 2000,
          workMinutesPerBatch: 1,
          requiredCapability: "processing"
        }
      ],
      [
        "landing-assemble-hauler",
        {
          inputs: [
            { itemId: "structural_frame", quantity: 4 },
            { itemId: "wire_cable", quantity: 2 },
            { itemId: "controller", quantity: 1 },
            { itemId: "spare_part", quantity: 2 }
          ],
          ratedW: 2000,
          workMinutesPerBatch: 3,
          requiredCapability: "processing"
        }
      ],
      [
        "landing-handcraft-spares",
        {
          inputs: [
            { itemId: "iron_ore", quantity: 2 },
            { itemId: "copper_ore", quantity: 2 }
          ],
          ratedW: 200,
          workMinutesPerBatch: 4,
          requiredCapability: "lander_manual",
          countsSlotMaintenance: false
        }
      ]
    ];
    for (const [stableId, expected] of expectations) {
      expect(byId.get(stableId)).toMatchObject(expected as Record<string, unknown>);
    }
    const assemble = byId.get("landing-assemble-hauler")!;
    expect("templateStableId" in assemble.output ? assemble.output.initialBatteryWh : undefined).toBe(0);
  });

  it("every project input is reachable from seed inventory or resource nodes", () => {
    const obtainable = new Set<string>([
      ...LANDING_PROVISION_SEED.inventory.map((entry) => entry.itemId),
      ...(LANDING_PROVISION_SEED.resourceNodes ?? []).map((node) => node.itemId)
    ]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const recipe of LANDING_RECIPE_TEMPLATES) {
        const inputsReady = recipe.inputs.every((input) => obtainable.has(input.itemId));
        if (!inputsReady) continue;
        const output = recipe.output;
        if ("itemId" in output) {
          // robot 产出不是材料，不入 obtainable。
          if (!obtainable.has(output.itemId)) {
            obtainable.add(output.itemId);
            grew = true;
          }
        }
      }
    }
    for (const project of LANDING_BASE_CONTENT_RELEASE.projects) {
      for (const input of project.inputs) {
        expect(obtainable.has(input.itemId), `${project.ref.stableId} input ${input.itemId}`).toBe(true);
      }
    }
    for (const recipe of LANDING_RECIPE_TEMPLATES) {
      for (const input of recipe.inputs) {
        expect(obtainable.has(input.itemId), `recipe ${recipe.ref.stableId} input ${input.itemId}`).toBe(true);
      }
    }
  });

  it("each landing kit is consumed by exactly one install project; install prerequisites reference built facilities", () => {
    const projects = LANDING_BASE_CONTENT_RELEASE.projects;
    const kitProjects = projects.filter((project) => !project.expansionSlot);
    expect(kitProjects.map((project) => project.ref.stableId)).toEqual([
      "landing-install-solar",
      "landing-install-warehouse",
      "landing-install-storage",
      "landing-install-charging",
      "landing-install-processing",
      "landing-install-maintenance"
    ]);
    for (const project of kitProjects) {
      expect(project.inputs.length).toBe(1);
      const facilityId = project.outputFacility.ref.stableId;
      for (const required of project.requiresFacilities ?? []) {
        const provider = kitProjects.find(
          (candidate) => candidate.outputFacility.ref.stableId === required
        );
        expect(provider, `${project.ref.stableId} prerequisite ${required} has a provider`).toBeDefined();
        expect(provider!.ref.stableId).not.toBe(facilityId);
      }
    }
    const expansionTemplates = projects.filter((project) => project.expansionSlot);
    expect(expansionTemplates.length).toBe(3);
  });
});
