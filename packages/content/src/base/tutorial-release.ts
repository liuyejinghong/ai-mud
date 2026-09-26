import type { ContentBaseRelease } from "./schemas.js";
import { DEFAULT_BASE_CONTENT_RELEASE } from "./default-release.js";

export const TUTORIAL_BASE_RELEASE_ID = "yudian-base-tutorial-1";

const oldTransportRecipe = DEFAULT_BASE_CONTENT_RELEASE.recipes.find(
  (recipe) => recipe.ref.stableId === "manufacture-yd-h1"
);
if (!oldTransportRecipe) throw new Error("Missing published transport recipe");

export const TUTORIAL_BASE_CONTENT_RELEASE: ContentBaseRelease = {
  ...DEFAULT_BASE_CONTENT_RELEASE,
  releaseId: TUTORIAL_BASE_RELEASE_ID,
  recipes: [
    {
      ...oldTransportRecipe,
      ref: { ...oldTransportRecipe.ref, revision: 2 },
      output: { ...oldTransportRecipe.output, initialBatteryWh: 1000 }
    },
    ...DEFAULT_BASE_CONTENT_RELEASE.recipes.filter(
      (recipe) => recipe.ref.stableId !== "manufacture-yd-h1"
    )
  ],
  provisionSeed: {
    ...DEFAULT_BASE_CONTENT_RELEASE.provisionSeed,
    releaseId: TUTORIAL_BASE_RELEASE_ID,
    devices: DEFAULT_BASE_CONTENT_RELEASE.provisionSeed.devices.map((device) =>
      device.templateStableId === "yd-h1" ? { ...device, initialBatteryWh: 5500 } : device
    )
  }
};
