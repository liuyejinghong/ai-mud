import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_CONTENT_RELEASE, type ContentBaseRelease } from "@ai-mud/content";
import { createContentCatalog } from "./catalog.service.js";
import { loadBootstrapRelease } from "./bootstrap-release.js";

function corruptedRelease(mutate: (release: ContentBaseRelease) => void): ContentBaseRelease {
  const release = structuredClone(DEFAULT_BASE_CONTENT_RELEASE);
  mutate(release);
  return release;
}

describe("createContentCatalog", () => {
  it("exposes the frozen v0.12 release id", () => {
    expect(createContentCatalog().releaseId()).toBe("yudian-base-0");
  });

  it("serves robot templates by stableId with fixture values and null for unknown ids", () => {
    const catalog = createContentCatalog();
    const hauler = catalog.getRobotTemplate("yd-h1");
    expect(hauler).not.toBeNull();
    expect(hauler).toMatchObject({
      ref: { kind: "robot_template", stableId: "yd-h1", revision: 1 },
      name: "驮运",
      groupId: "transport",
      batteryCapacityWh: 20000,
      chargeRateW: 4000,
      workRatePerTick: 1
    });
    expect(catalog.getRobotTemplate("yd-e1")).toMatchObject({
      groupId: "engineering",
      batteryCapacityWh: 30000,
      chargeRateW: 6000
    });
    expect(catalog.getRobotTemplate("yd-s1")).toMatchObject({
      groupId: "survey",
      batteryCapacityWh: 10000,
      chargeRateW: 2000
    });
    expect(catalog.getRobotTemplate("yd-x9")).toBeNull();
  });

  it("serves the first project template with ordered steps and output facility", () => {
    const catalog = createContentCatalog();
    const project = catalog.getProjectTemplate("install-solar-array");
    expect(project).not.toBeNull();
    expect(project!.ref).toEqual({ kind: "project", stableId: "install-solar-array", revision: 1 });
    expect(project!.name).toBe("安装运抵的太阳能设施");
    expect(project!.steps.map((step) => [step.kind, step.groupId, step.workRequired])).toEqual([
      ["site_clearing", "engineering", 40],
      ["transport", "transport", 60],
      ["installation", "engineering", 80],
      ["commissioning", "survey", 20]
    ]);
    expect(project!.outputFacility).toEqual({
      ref: { kind: "facility", stableId: "solar-array-unit", revision: 1 },
      name: "太阳能阵列单元",
      generationWPeak: 5000
    });
    expect(catalog.getProjectTemplate("dig-canals")).toBeNull();
  });

  it("lists every robot and project template of the release", () => {
    const catalog = createContentCatalog();
    const templates = catalog.listTemplates();
    expect(templates.robots.map((robot) => robot.ref.stableId)).toEqual(["yd-h1", "yd-e1", "yd-s1"]);
    expect(templates.projects.map((project) => project.ref.stableId)).toEqual([
      "install-solar-array"
    ]);
  });

  it("serves a complete provision seed per the ContentCatalogPort contract", () => {
    const catalog = createContentCatalog();
    const seed = catalog.getProvisionSeed();

    expect(seed.releaseId).toBe("yudian-base-0");
    expect(typeof seed.baseName).toBe("string");
    expect(seed.baseName.length).toBeGreaterThan(0);

    expect(seed.power).toEqual({
      generationWPeak: 15000,
      storageCapacityWh: 200000,
      initialStorageWh: 100000
    });

    expect(seed.sites).toHaveLength(6);
    expect(seed.sites.filter((site) => site.state === "free").map((site) => site.siteKey)).toEqual([
      "site_a"
    ]);
    for (const site of seed.sites) {
      if (site.state === "built") {
        expect(site.facilityRef).toMatchObject({ kind: "facility", revision: 1 });
      }
    }

    const inventory = new Map(seed.inventory.map((entry) => [entry.itemId, entry.quantity]));
    const project = catalog.getProjectTemplate("install-solar-array")!;
    for (const input of project.inputs) {
      expect(inventory.get(input.itemId) ?? 0).toBeGreaterThanOrEqual(input.quantity);
    }
    expect(inventory.get("spare_parts")).toBe(30);

    expect(seed.devices.map((device) => device.templateStableId)).toEqual([
      "yd-h1",
      "yd-e1",
      "yd-s1"
    ]);
    expect(seed.devices.reduce((sum, device) => sum + device.count, 0)).toBe(12);
    expect(seed.devices.map((device) => device.initialBatteryWh)).toEqual([12000, 18000, 6000]);
  });

  it("hands out fresh read-only copies instead of catalog internals", () => {
    const catalog = createContentCatalog();
    const seed = catalog.getProvisionSeed();
    seed.power.generationWPeak = 0;
    seed.inventory.length = 0;

    const next = catalog.getProvisionSeed();
    expect(next.power.generationWPeak).toBe(15000);
    expect(next.inventory).toHaveLength(6);

    const hauler = catalog.getRobotTemplate("yd-h1")!;
    hauler.batteryCapacityWh = 1;
    expect(catalog.getRobotTemplate("yd-h1")!.batteryCapacityWh).toBe(20000);
  });

  it("fails fast at construction when the release violates content validation", () => {
    expect(() =>
      createContentCatalog(
        corruptedRelease((release) => {
          release.robots[0]!.chargeRateW = -4000;
        })
      )
    ).toThrowError(/chargeRateW/);

    expect(() =>
      createContentCatalog(
        corruptedRelease((release) => {
          release.provisionSeed.inventory = release.provisionSeed.inventory.filter(
            (entry) => entry.itemId !== "anchor"
          );
        })
      )
    ).toThrowError(/anchor/);

    expect(() =>
      createContentCatalog(
        corruptedRelease((release) => {
          release.provisionSeed.releaseId = "yudian-base-9";
        })
      )
    ).toThrowError(/releaseId/);
  });
});

describe("loadBootstrapRelease", () => {
  it("statically serves the built-in default release with no publish path", () => {
    const release = loadBootstrapRelease();
    expect(release.releaseId).toBe("yudian-base-0");
    expect(release).toEqual(DEFAULT_BASE_CONTENT_RELEASE);
    expect(() => createContentCatalog(release)).not.toThrow();
  });
});
