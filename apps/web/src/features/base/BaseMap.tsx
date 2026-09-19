// 中央基地地图：把站点渲染成可点击的方块。点击只上报 siteId，不做任何业务判断。
import type { BaseProjectDto, BaseSiteDto } from "@ai-mud/shared";

const ACTIVE_PROJECT_STATUSES = new Set(["planned", "active", "paused", "blocked"]);

function describeSite(site: BaseSiteDto, projects: BaseProjectDto[]): { title: string; note: string } {
  if (site.state === "free") {
    return { title: site.name, note: "可建设位" };
  }

  const siteProjects = projects.filter((project) => project.siteId === site.siteId);

  if (site.state === "reserved") {
    const ongoing = siteProjects.find((project) => ACTIVE_PROJECT_STATUSES.has(project.status));
    return {
      title: site.name,
      note: ongoing ? `施工中：${ongoing.name}` : "已预留，等待施工"
    };
  }

  const completed = siteProjects.find((project) => project.status === "completed");
  return {
    title: completed ? completed.name : site.name,
    note: "设施已建成"
  };
}

export interface BaseMapProps {
  sites: BaseSiteDto[];
  projects: BaseProjectDto[];
  selectedSiteId: string | null;
  onSelectSite: (siteId: string) => void;
}

export function BaseMap({ sites, projects, selectedSiteId, onSelectSite }: BaseMapProps) {
  return (
    <section className="base-panel base-map" aria-label="基地地图">
      <h2 className="base-panel-title">基地地图</h2>
      <div className="base-site-grid">
        {sites.map((site) => {
          const { title, note } = describeSite(site, projects);
          const isSelected = selectedSiteId === site.siteId;
          return (
            <button
              key={site.siteId}
              type="button"
              className={`base-site-card base-site-${site.state}${isSelected ? " is-selected" : ""}`}
              aria-pressed={isSelected}
              onClick={() => onSelectSite(site.siteId)}
            >
              <span className="base-site-title">{title}</span>
              <span className="base-site-note">{note}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
