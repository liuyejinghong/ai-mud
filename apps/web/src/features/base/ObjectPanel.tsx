import { newCommandId } from "../../lib/uuid.js";
import { BASE_ITEM_NAMES, describeReservationSources } from "./EconomyBoard.js";
// 右侧对象面板：根据当前选中对象（项目 / 设备 / 站点）展示快照里的事实与可用操作。
import type {
  BaseDeviceDto,
  BaseProjectDto,
  BaseResourceDto,
  BaseSiteDto,
  BaseTimeMode,
  CreateProjectInputDto,
  DefinitionRefDto,
  PurchaseOrderDto,
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
  inputs?: Array<{ itemId: string; quantity: number }>;
}

export interface ObjectPanelProps {
  sites: BaseSiteDto[];
  projects: BaseProjectDto[];
  devices: BaseDeviceDto[];
  buildableProjects: BuildableTemplateDto[];
  resources: BaseResourceDto[];
  purchases: PurchaseOrderDto[];
  selectedResourceId: string | null;
  selectedSiteId: string | null;
  selectedProjectId: string | null;
  selectedDeviceId: string | null;
  timeMode: BaseTimeMode;
  isBusy: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (input: CreateProjectInputDto) => void;
  onCancelProject: (projectId: string) => void;
  onResume: () => void;
}

export function ObjectPanel({
  sites,
  projects,
  devices,
  buildableProjects,
  resources,
  purchases,
  selectedResourceId,
  selectedSiteId,
  selectedProjectId,
  selectedDeviceId,
  timeMode,
  isBusy,
  onSelectProject,
  onCreateProject,
  onCancelProject,
  onResume
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
  const selectedResource =
    selectedResourceId !== null
      ? (resources.find((resource) => resource.itemId === selectedResourceId) ?? null)
      : null;

  return (
    <aside className="base-panel base-object-panel" aria-label="对象详情">
      <h2 className="base-panel-title">对象详情</h2>

      {selectedResource ? (
        <ResourceDetail resource={selectedResource} purchases={purchases} />
      ) : selectedProject ? (
        <ProjectDetail
          project={selectedProject}
          timeMode={timeMode}
          isBusy={isBusy}
          onCancelProject={onCancelProject}
          onResume={onResume}
        />
      ) : selectedDevice ? (
        <DeviceDetail device={selectedDevice} projects={projects} />
      ) : selectedSite ? (
        <SiteDetail
          site={selectedSite}
          buildableProjects={buildableProjects}
          projects={projects}
          resources={resources}
          purchases={purchases}
          isBusy={isBusy}
          onSelectProject={onSelectProject}
          onCreateProject={onCreateProject}
        />
      ) : selectedResourceId || selectedProjectId || selectedDeviceId || selectedSiteId ? (
        <p className="base-copy">所选对象已不在当前基地状态中，请返回地图重新选择。</p>
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
  timeMode,
  isBusy,
  onCancelProject,
  onResume
}: {
  project: BaseProjectDto;
  timeMode: BaseTimeMode;
  isBusy: boolean;
  onCancelProject: (projectId: string) => void;
  onResume: () => void;
}) {
  const cancellable = project.status !== "completed" && project.status !== "cancelled" && project.status !== "failed";

  return (
    <div className="base-detail">
      <h3>{project.name}</h3>
      <p className="base-detail-line">状态：{PROJECT_STATUS_LABELS[project.status]}</p>
      {timeMode === "paused" && cancellable ? (
        <div className="base-paused-task">
          <p className="base-copy">
            基地时间已暂停，此项目不会推进。
            {project.status === "blocked"
              ? "恢复计时后仍需解决受阻条件。"
              : "恢复计时后重新检查施工条件。"}
          </p>
          <button type="button" className="base-primary-button" disabled={isBusy} onClick={onResume}>
            恢复计时
          </button>
        </div>
      ) : null}
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
      {device.description ? <p className="base-copy">{device.description}</p> : null}
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
      <p className="base-copy">任务由基地调度系统自动分配；手动指派将在后续版本开放。</p>
    </div>
  );
}

function ResourceDetail({ resource, purchases }: {
  resource: BaseResourceDto;
  purchases: PurchaseOrderDto[];
}) {
  const inTransit = purchases.filter((purchase) =>
    purchase.itemId === resource.itemId && purchase.status === "in_transit"
  ).reduce((sum, purchase) => sum + purchase.quantity, 0);
  return (
    <div className="base-detail">
      <h3>{resource.name}</h3>
      <p className="base-detail-line">库存总量：×{resource.quantity}</p>
      <p className="base-detail-line">已占用：×{resource.reservedQuantity}</p>
      <p className="base-detail-line">可支配：×{resource.quantity - resource.reservedQuantity}</p>
      {resource.reservationSources.length > 0 ? (
        <ul className="base-attr-list" aria-label="占用去向">
          {resource.reservationSources.map((source) => (
            <li key={`${source.kind}:${source.id}`}>
              {source.kind === "project" ? "工程" : "制造工单"}「{source.name}」占用 ×{source.quantity}
            </li>
          ))}
        </ul>
      ) : null}
      {inTransit > 0 ? <p className="base-detail-line">在途：×{inTransit}（到货前不可支配）</p> : null}
      <p className="base-copy">{resource.description}</p>
    </div>
  );
}

function SiteDetail({
  site,
  buildableProjects,
  projects,
  resources,
  purchases,
  isBusy,
  onSelectProject,
  onCreateProject
}: {
  site: BaseSiteDto;
  buildableProjects: BuildableTemplateDto[];
  projects: BaseProjectDto[];
  resources: BaseResourceDto[];
  purchases: PurchaseOrderDto[];
  isBusy: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (input: CreateProjectInputDto) => void;
}) {
  if (site.state === "built") {
    return (
      <div className="base-detail">
        <h3>{site.name}</h3>
        {site.description ? <p className="base-copy">{site.description}</p> : null}
        {site.attributes.length > 0 ? (
          <ul className="base-attr-list">
            {site.attributes.map((attribute) => (
              <li key={attribute.label} className="base-detail-line">
                {attribute.label}：{attribute.value}
              </li>
            ))}
          </ul>
        ) : null}
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
        <h3>{site.name}</h3>
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
      <h3>{site.name}</h3>
      <p className="base-detail-line">这是一块空地，可以开工一个项目。</p>
      {templates.length === 0 ? (
        <p className="base-copy">现在还没有可建的项目。</p>
      ) : (
        <ul className="base-buildable-list">
          {templates.map((template) => (
            <li key={definitionRefKey(template.definitionRef)}>
              <span className="base-buildable-name">{template.name}</span>
              <span className="base-copy">{template.description}</span>
              {template.inputs ? (
                <ul className="base-buildable-inputs">
                  {template.inputs.map((input) => {
                    const resource = resources.find((row) => row.itemId === input.itemId);
                    const available = resource ? resource.quantity - resource.reservedQuantity : 0;
                    const inTransit = purchases.filter((purchase) =>
                      purchase.itemId === input.itemId && purchase.status === "in_transit"
                    ).reduce((sum, purchase) => sum + purchase.quantity, 0);
                    const short = available < input.quantity;
                    const sourceSummary = describeReservationSources(resource);
                    return (
                      <li key={input.itemId}>
                        {BASE_ITEM_NAMES[input.itemId] ?? input.itemId} ×{input.quantity}
                        （可支配 {available}，总量 {resource?.quantity ?? 0}，已占用 {resource?.reservedQuantity ?? 0}
                        {short ? `，缺 ${input.quantity - available}` : ""}
                        {inTransit > 0 ? `，在途 ${inTransit}（到货前不可用）` : ""}）
                        {sourceSummary ? ` 占用去向：${sourceSummary}` : ""}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <button
                type="button"
                className="base-primary-button"
                disabled={isBusy}
                onClick={() =>
                  onCreateProject({
                    definitionRef: template.definitionRef,
                    siteId: site.siteId,
                    commandId: newCommandId()
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
