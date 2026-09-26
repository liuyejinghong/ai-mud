import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_CONTENT_RELEASE } from "./default-release.js";
import { TUTORIAL_BASE_CONTENT_RELEASE } from "./index.js";
import { validateProvisionSeed, validateRecipeTemplate } from "./schemas.js";

describe("yudian-base-tutorial-1 release", () => {
  it("keeps the old release unchanged and seeds four low-charge transport robots", () => {
    const tutorial = TUTORIAL_BASE_CONTENT_RELEASE;
    expect(tutorial.releaseId).toBe("yudian-base-tutorial-1");
    expect(tutorial.provisionSeed.releaseId).toBe(tutorial.releaseId);
    expect(tutorial.provisionSeed.devices).toEqual([
      { templateStableId: "yd-h1", groupId: "transport", count: 4, initialBatteryWh: 5500 },
      ...DEFAULT_BASE_CONTENT_RELEASE.provisionSeed.devices.slice(1)
    ]);
    expect(DEFAULT_BASE_CONTENT_RELEASE.provisionSeed.devices[0]?.initialBatteryWh).toBe(12000);
    expect(validateProvisionSeed(tutorial.provisionSeed, tutorial.robots, tutorial.projects)).toEqual([]);
  });

  it("offers only the new transport recipe revision and existing survey recipe", () => {
    const tutorial = TUTORIAL_BASE_CONTENT_RELEASE;
    expect(tutorial.recipes.map((recipe) => [recipe.ref.stableId, recipe.ref.revision])).toEqual([
      ["manufacture-yd-h1", 2],
      ["manufacture-yd-s1", 1]
    ]);
    expect(tutorial.recipes[0]).toEqual({
      ...DEFAULT_BASE_CONTENT_RELEASE.recipes[0],
      ref: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 2 },
      output: { templateStableId: "yd-h1", initialBatteryWh: 1000 }
    });
    expect(tutorial.recipes.flatMap(validateRecipeTemplate)).toEqual([]);
    expect(DEFAULT_BASE_CONTENT_RELEASE.recipes[0]?.ref.revision).toBe(1);
    expect(DEFAULT_BASE_CONTENT_RELEASE.recipes[0]?.output.initialBatteryWh).toBe(12000);
  });

  it("reuses the other published definitions and seed values", () => {
    const tutorial = TUTORIAL_BASE_CONTENT_RELEASE;
    expect(tutorial.itemNames).toEqual(DEFAULT_BASE_CONTENT_RELEASE.itemNames);
    expect(tutorial.robots).toEqual(DEFAULT_BASE_CONTENT_RELEASE.robots);
    expect(tutorial.projects).toEqual(DEFAULT_BASE_CONTENT_RELEASE.projects);
    expect(tutorial.orderTemplates).toEqual(DEFAULT_BASE_CONTENT_RELEASE.orderTemplates);
    expect(tutorial.provisionSeed.power).toEqual(DEFAULT_BASE_CONTENT_RELEASE.provisionSeed.power);
    expect(tutorial.provisionSeed.inventory).toEqual(DEFAULT_BASE_CONTENT_RELEASE.provisionSeed.inventory);
    expect(tutorial.provisionSeed.sites).toEqual(DEFAULT_BASE_CONTENT_RELEASE.provisionSeed.sites);
  });
});
