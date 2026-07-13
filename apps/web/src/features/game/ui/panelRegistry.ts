import type { OfflineReportDto, WorldRumorDto } from "@ai-mud/shared";

export type AuxiliaryPanelId = "map" | "rumors" | "offline";

export interface AuxiliaryPanelView {
  hasMap: boolean;
  rumorCount: number;
  offlineReport: OfflineReportDto | null;
}

export interface PanelRegistration {
  id: AuxiliaryPanelId;
  title: string;
  badge?: (view: AuxiliaryPanelView) => number | string | null;
  visibleWhen: (view: AuxiliaryPanelView) => boolean;
}

export const AUXILIARY_PANEL_REGISTRY: readonly PanelRegistration[] = [
  {
    id: "map",
    title: "地图",
    visibleWhen: () => true
  },
  {
    id: "rumors",
    title: "传闻",
    badge: (view) => (view.rumorCount > 0 ? view.rumorCount : null),
    visibleWhen: () => true
  },
  {
    id: "offline",
    title: "离线简报",
    visibleWhen: () => true
  }
];

export function getVisibleAuxiliaryPanels(
  view: AuxiliaryPanelView
): readonly PanelRegistration[] {
  return AUXILIARY_PANEL_REGISTRY.filter((panel) => panel.visibleWhen(view));
}

export function createAuxiliaryPanelView(
  map: unknown,
  rumors: readonly WorldRumorDto[],
  offlineReport: OfflineReportDto | null
): AuxiliaryPanelView {
  return {
    hasMap: map !== null,
    rumorCount: rumors.length,
    offlineReport
  };
}
