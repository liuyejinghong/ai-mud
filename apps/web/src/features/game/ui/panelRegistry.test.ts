import { describe, expect, it } from "vitest";
import type { WorldRumorDto } from "@ai-mud/shared";
import {
  AUXILIARY_PANEL_REGISTRY,
  createAuxiliaryPanelView,
  getVisibleAuxiliaryPanels
} from "./panelRegistry";

describe("auxiliary panel registry", () => {
  it("keeps the initial auxiliary surface data-driven", () => {
    const rumors = [{ id: "rumor-1" } as WorldRumorDto];
    const view = createAuxiliaryPanelView(null, rumors, null);
    const panels = getVisibleAuxiliaryPanels(view);

    expect(panels.map((panel) => panel.id)).toEqual(["map", "rumors", "offline"]);
    expect(AUXILIARY_PANEL_REGISTRY.find((panel) => panel.id === "rumors")?.badge?.(view)).toBe(1);
  });
});
