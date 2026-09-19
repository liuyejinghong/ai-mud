// 右侧对象面板：根据当前选中对象（项目 / 设备 / 站点）展示快照里的事实与可用操作。
import type {
  BaseDeviceDto,
  BaseProjectDto,
  BaseSiteDto,
  CreateProjectInputDto,
  DefinitionRefDto,
  RobotStatus
} from "@ai-mud/shared";
import { BASE_ROBOT_GROUP_NAMES, definitionRefKey } from "@ai-mud/shared";
import {
  describeBlockedReason,
  PROJECT_STATUS_LABELS,
  STEP_KIND_LABELS,
  STEP_STATUS_LABELS
} from "./ProjectBoard.js";

const ROBOT_STATUS_LABELS: Record<RobotStatus, string> = {
  idle: "待命",
  charging: "充电中",
  working: "作业中",
  offline: "离线"
};

const CANCEL_CONFIRM_TEXT =
  "取消后项目立即停止：没用掉的材料会退还仓库，已经消耗的部分不退还。确定要取消吗？";

interface BuildableTemplateDto {
  definitionRef: DefinitionRefDto;
  name: string;
  description: string;
}

export interface ObjectPanelProps {
  sites: BaseSiteDto[];
  projects: BaseProjectDto[];
  devices: BaseDeviceDto[];
  buildableProjects: BuildableTemplateDto[];
  selectedSiteId: string | null;
  selectedProjectId: string | null;
  selectedDeviceId: string | null;
  isBusy: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (input: CreateProjectInputDto) => void;
  onCancelProject: (projectId: string) => void;
}

export function ObjectPanel({
  sites,
  projects,
  devices,
  buildableProjects,
  selectedSiteId,
  selectedProjectId,
  selectedDeviceId,
  isBusy,
  onSelectProject,
  onCreateProject,
  onCancelProject
}: ObjectPanelProps) {
  const selectedProject =
    selectedProjectId !== null
      ? (projects.find((project) => project.projectId === selectedProjectId) ?? null)
      : null;
  const selectedDevice =
    selectedDeviceId !== null
      ? (devices.find((device) => device.deviceId === selectedDeviceId) ?? null)
      : null;
  const selectedSite =
    selectedSiteId !== null
      ? (sites.find((site) => site.siteId === selectedSiteId) ?? null)
      : null;

  return (
    <aside className="base-panel base-object-panel" aria-label="对象详情">
      <h2 className="base-panel-title">对象详情</h2>

      {selectedProject ? (
        <ProjectDetail
          project={selectedProject}
          isBusy={isBusy}
          onCancelProject={onCancelProject}
        />
      ) : selectedDevice ? (
        <DeviceDetail device={selectedDevice} projects={projects} />
      ) : selectedSite ? (
        <SiteDetail
          site={selectedSite}
          buildableProjects={buildableProjects}
          projects={projects}
          isBusy={isBusy}
          onSelectProject={onSelectProject}
          onCreateProject={onCreateProject}
        />
      ) : (
        <p className="base-copy">
          点击地图上的地点、下方项目或顶部设备，查看它的详情。
        </p>
      )}
    </aside>
  );
}

function ProjectDetail({
  project,
  isBusy,
  onCancelProject
}: {
  project: BaseProjectDto;
  isBusy: boolean;
  onCancelProject: (projectId: string) => void;
}) {
  const cancellable = project.status !== "completed" && project.status !== "cancelled" && project.status !== "failed";

  return (
    <div className="base-detail">
      <h3>{project.name}</h3>
      <p className="base-detail-line">状态：{PROJECT_STATUS_LABELS[project.status]}</p>
      <ol className="base-step-list">
        {project.steps.map((step) => {
          const blockedLabel = describeBlockedReason(step.blockedReason);
          return (
            <li key={step.index} className={`base-step base-step-${step.status}`}>
              <span className="base-step-title">
                {STEP_KIND_LABELS[step.kind]} · {STEP_STATUS_LABELS[step.status]}
              </span>
              <span className="base-step-progress">
                工作量 {step.workDone}/{step.workRequired}
              </span>
              {blockedLabel ? (
                <span className="base-blocked-reason">受阻：{blockedLabel}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {cancellable ? (
        <button
          type="button"
          className="base-danger-button"
          disabled={isBusy}
          onClick={() => {
            if (window.confirm(CANCEL_CONFIRM_TEXT)) {
              onCancelProject(project.projectId);
            }
          }}
        >
          取消项目
        </button>
      ) : (
        <p className="base-copy">该项目已结束，不能取消。</p>
      )}
    </div>
  );
}

function DeviceDetail({
  device,
  projects
}: {
  device: BaseDeviceDto;
  projects: BaseProjectDto[];
}) {
  const batteryPercent =
    device.batteryCapacityWh > 0
      ? Math.round((device.batteryWh / device.batteryCapacityWh) * 100)
      : 0;
  const assignmentProject =
    device.currentAssignment !== null
      ? (projects.find((project) => project.projectId === device.currentAssignment?.projectId) ??
        null)
      : null;
  const assignmentStep =
    assignmentProject && device.currentAssignment
      ? (assignmentProject.steps[device.currentAssignment.stepIndex] ?? null)
      : null;

  return (
    <div className="base-detail">
      <h3>{device.name}</h3>
      <p className="base-detail-line">编组：{BASE_ROBOT_GROUP_NAMES[device.groupId]}</p>
      <p className="base-detail-line">状态：{ROBOT_STATUS_LABELS[device.status]}</p>
      <p className="base-detail-line">
        电量：{device.batteryWh}/{device.batteryCapacityWh} Wh（约 {batteryPercent}%）
      </p>
      <p className="base-detail-line">
        {assignmentProject
          ? `当前任务：${assignmentProject.name}${
              assignmentStep ? `（${STEP_KIND_LABELS[assignmentStep.kind]}）` : ""
            }`
          : "当前任务：空闲，等待安排"}
      </p>
    </div>
  );
}

function SiteDetail({
  site,
  buildableProjects,
  projects,
  isBusy,
  onSelectProject,
  onCreateProject
}: {
  site: BaseSiteDto;
  buildableProjects: BuildableTemplateDto[];
  projects: BaseProjectDto[];
  isBusy: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (input: CreateProjectInputDto) => void;
}) {
  if (site.state === "built") {
    return (
      <div className="base-detail">
        <h3>{site.siteKey}</h3>
        <p className="base-detail-line">这里已经建成设施，暂时没有可安排的工程。</p>
      </div>
    );
  }

  if (site.state === "reserved") {
    const ongoing = projects.find(
      (project) =>
        project.siteId === site.siteId &&
        (project.status === "planned" ||
          project.status === "active" ||
          project.status === "paused" ||
          project.status === "blocked")
    );
    return (
      <div className="base-detail">
        <h3>{site.siteKey}</h3>
        <p className="base-detail-line">
          {ongoing ? `有项目正在这里施工：${ongoing.name}` : "这里已预留，等待项目开工。"}
        </p>
        {ongoing ? (
          <button type="button" className="base-link-button" onClick={() => onSelectProject(ongoing.projectId)}>
            查看这个项目
          </button>
        ) : null}
      </div>
    );
  }

  const templates = buildableProjects;
  return (
    <div className="base-detail">
      <h3>{site.siteKey}</h3>
      <p className="base-detail-line">这是一块空地，可以开工一个项目。</p>
      {templates.length === 0 ? (
        <p className="base-copy">现在还没有可建的项目。</p>
      ) : (
        <ul className="base-buildable-list">
          {templates.map((template) => (
            <li key={definitionRefKey(template.definitionRef)}>
              <span className="base-buildable-name">{template.name}</span>
              <span className="base-copy">{template.description}</span>
              <button
                type="button"
                className="base-primary-button"
                disabled={isBusy}
                onClick={() =>
                  onCreateProject({
                    definitionRef: template.definitionRef,
                    siteId: site.siteId,
                    commandId: crypto.randomUUID()
                  })
                }
              >
                在这里建设
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
