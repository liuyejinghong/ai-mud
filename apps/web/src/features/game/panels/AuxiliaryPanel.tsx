import { useId } from "react";
import type {
  Direction,
  GameStateDto,
  OfflineReportDto,
  WorldRumorDto
} from "@ai-mud/shared";
import {
  createAuxiliaryPanelView,
  getVisibleAuxiliaryPanels,
  type AuxiliaryPanelId
} from "../ui/panelRegistry";
import { mapCellText } from "./panelFormatters";

export type AuxiliaryPanelTab = AuxiliaryPanelId;

export interface AuxiliaryPanelProps {
  map: GameStateDto["map"];
  rumors: readonly WorldRumorDto[];
  offlineReport: OfflineReportDto | null;
  activeTab: AuxiliaryPanelTab;
  onActiveTabChange: (tab: AuxiliaryPanelTab) => void;
  canMove: boolean;
  onMove: (direction: Direction) => void | Promise<void>;
  isOpen?: boolean;
  onClose?: () => void;
}

export function AuxiliaryPanel({
  map,
  rumors,
  offlineReport,
  activeTab,
  onActiveTabChange,
  canMove,
  onMove,
  isOpen = true,
  onClose
}: AuxiliaryPanelProps) {
  const panelId = useId();
  const tabs = getVisibleAuxiliaryPanels(
    createAuxiliaryPanelView(map, rumors, offlineReport)
  );

  return (
    <aside
      id="auxiliary-panel"
      className={`game-column game-map-panel${isOpen ? " is-open" : ""}`}
      aria-label="小地图与辅助信息"
    >
      {onClose ? (
        <button type="button" className="auxiliary-close" onClick={onClose}>
          收起
        </button>
      ) : null}
      <div className="lobby-tabs" role="tablist" aria-label="辅助面板">
        {tabs.map((tab) => (
          <button
            type="button"
            id={`${panelId}-${tab.id}-tab`}
            className={activeTab === tab.id ? "is-selected" : ""}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`${panelId}-${tab.id}-panel`}
            key={tab.id}
            onClick={() => onActiveTabChange(tab.id)}
          >
            {tab.title}
          </button>
        ))}
      </div>

      {activeTab === "map" ? (
        <section
          className="game-panel nav-map-panel"
          id={`${panelId}-map-panel`}
          role="tabpanel"
          aria-labelledby={`${panelId}-map-tab`}
        >
          <div className="panel-heading">
            <h2>小地图</h2>
            {map ? <span>{map.width} x {map.height}</span> : <span>村镇</span>}
          </div>
          {map ? (
            <div
              className="mini-map"
              style={{ gridTemplateColumns: `repeat(${map.width}, minmax(0, 1fr))` }}
              aria-label="当前位置小地图"
            >
              {map.cells.map((cell) => (
                <span
                  key={`${cell.x}:${cell.y}`}
                  className={`mini-map-cell ${cell.markers
                    .map((marker) => `is-${marker}`)
                    .join(" ")}`}
                  title={`x:${cell.x} y:${cell.y}`}
                >
                  {mapCellText(cell.markers)}
                </span>
              ))}
            </div>
          ) : (
            <p className="empty-copy">当前在村镇区域，无野外方格。</p>
          )}
          <div className="direction-pad" aria-label="移动">
            <button
              type="button"
              disabled={!canMove}
              className="direction-button north"
              aria-label="向北移动"
              onClick={() => void onMove("north")}
            >
              W
            </button>
            <button
              type="button"
              disabled={!canMove}
              className="direction-button west"
              aria-label="向西移动"
              onClick={() => void onMove("west")}
            >
              A
            </button>
            <button
              type="button"
              disabled={!canMove}
              className="direction-button south"
              aria-label="向南移动"
              onClick={() => void onMove("south")}
            >
              S
            </button>
            <button
              type="button"
              disabled={!canMove}
              className="direction-button east"
              aria-label="向东移动"
              onClick={() => void onMove("east")}
            >
              D
            </button>
          </div>
        </section>
      ) : null}

      {activeTab !== "rumors" && rumors.length > 0 ? (
        <section className="auxiliary-preview" aria-label="最新传闻">
          <div className="panel-heading"><h2>最新一条</h2><span>传闻 {rumors.length} 条</span></div>
          <p>{rumors[0]?.message}</p>
        </section>
      ) : null}

      {activeTab !== "offline" && offlineReport ? (
        <section className="auxiliary-preview" aria-labelledby="offline-report-preview-title">
          <div className="panel-heading"><h2 id="offline-report-preview-title">{offlineReport.title}</h2></div>
          <p>{offlineReport.summary}</p>
          {offlineReport.highlights.length > 0 ? (
            <ul>
              {offlineReport.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}

      {activeTab === "rumors" ? (
        <section
          className="rumor-panel"
          id={`${panelId}-rumors-panel`}
          role="tabpanel"
          aria-labelledby={`${panelId}-rumors-tab`}
        >
          <div className="panel-heading">
            <h2>传闻</h2>
            <span>{rumors.length} 条</span>
          </div>
          {rumors.length === 0 ? (
            <p className="empty-copy">暂时没有新的传闻。</p>
          ) : (
            <ul className="rumor-list">
              {rumors.map((rumor) => (
                <li key={rumor.id}>{rumor.message}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === "offline" ? (
        <section
          className="offline-report-panel"
          id={`${panelId}-offline-panel`}
          role="tabpanel"
          aria-labelledby={`${panelId}-offline-tab`}
        >
          {offlineReport ? (
            <>
              <div className="panel-heading">
                <h2>{offlineReport.title}</h2>
              </div>
              <p>{offlineReport.summary}</p>
              {offlineReport.highlights.length > 0 ? (
                <ul>
                  {offlineReport.highlights.map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="empty-copy">暂无离线简报。</p>
          )}
        </section>
      ) : null}
    </aside>
  );
}
