// 基地工作区只组织已有快照和命令，不发额外请求。
import { useEffect, useRef, useState } from "react";
import type {
  BaseClockCommandInputDto,
  CreateManufacturingJobInputDto,
  BaseDeviceDto,
  BaseSnapshotDto,
  CreateProjectInputDto,
  RobotStatus
} from "@ai-mud/shared";
import { BaseMap } from "./BaseMap.js";
import { CooperationPanel } from "./CooperationPanel.js";
import { EconomyBoard } from "./EconomyBoard.js";
import { ManufacturingBoard } from "./ManufacturingBoard.js";
import { ObjectPanel } from "./ObjectPanel.js";
import { ProjectBoard, PROJECT_STATUS_LABELS, STEP_KIND_LABELS, describeBlockedReason } from "./ProjectBoard.js";
import "./base.css";

const ROBOT_STATUS_LABELS: Record<RobotStatus, string> = {
  idle: "待命",
  charging: "充电中",
  working: "作业中",
  offline: "离线"
};

function kw(watts: number): string {
  return (watts / 1000).toFixed(1);
}

function kwh(wattHours: number): string {
  return (wattHours / 1000).toFixed(1);
}

type Workspace = "base" | "economy" | "manufacturing" | "cooperation";
export type BaseActionFeedback = {
  area: "base" | "clock" | "economy" | "manufacturing" | "cooperation";
  kind: "pending" | "success" | "error";
  message: string;
};

export interface BaseShellProps {
  snapshot: BaseSnapshotDto;
  selectedJobId: string | null;
  selectedResourceId: string | null;
  csrfToken: string | null;
  selectedSiteId: string | null;
  selectedProjectId: string | null;
  selectedDeviceId: string | null;
  isBusy: boolean;
  onSelectSite: (siteId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectDevice: (deviceId: string) => void;
  onCreateProject: (input: CreateProjectInputDto) => void;
  onCancelProject: (projectId: string) => void;
  onClockCommand: (input: BaseClockCommandInputDto, area?: "base" | "clock") => void;
  onSetSpeed: (speed: number) => void;
  onSelectResource: (itemId: string) => void;
  onLogout: () => void;
  onCreateJob: (input: CreateManufacturingJobInputDto) => void;
  onCancelJob: (jobId: string) => void;
  onSelectJob: (jobId: string) => void;
  onAcceptOrder: (orderId: string) => void;
  onDeliverOrder: (orderId: string) => void;
  onPurchase: (itemId: string, quantity: number) => void;
  onCooperationDecision?: (requestId: string, action: "support" | "wait", expectedHelperOperatorId?: string) => void;
  onAcquireControl?: () => void;
  hasControl?: boolean;
  accountEmail?: string | null;
  actionFeedback?: BaseActionFeedback | null;
}

export function BaseShell({
  snapshot,
  selectedJobId,
  selectedResourceId,
  csrfToken,
  selectedSiteId,
  selectedProjectId,
  selectedDeviceId,
  isBusy,
  onSelectSite,
  onSelectProject,
  onSelectDevice,
  onCreateProject,
  onCancelProject,
  onClockCommand,
  onSetSpeed,
  onSelectResource,
  onLogout,
  onCreateJob,
  onCancelJob,
  onSelectJob,
  onAcceptOrder,
  onDeliverOrder,
  onPurchase,
  onCooperationDecision,
  onAcquireControl,
  hasControl = true,
  accountEmail = null,
  actionFeedback = null,
}: BaseShellProps) {
  const [workspace, setWorkspace] = useState<Workspace>("base");
  const [detailOpen, setDetailOpen] = useState(false);
  const focusTarget = useRef<"map" | "detail" | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const isPaused = snapshot.timeMode === "paused";
  const canControl = hasControl && snapshot.controlLease.heldByThisSession;
  const controlActive = snapshot.controlLease.controlActive;
  const hasSelection = selectedSiteId !== null || selectedProjectId !== null ||
    selectedDeviceId !== null || selectedResourceId !== null;
  const activeProject = snapshot.projects.find((project) =>
    project.status === "planned" || project.status === "active" ||
    project.status === "paused" || project.status === "blocked"
  );
  const freeSite = snapshot.sites.find((site) => site.state === "free");
  const nextProject = snapshot.buildableProjects[0];
  const activeRequests = snapshot.cooperationRequests.filter((request) =>
    request.status === "pending" || request.status === "accepted"
  ).length;
  const pendingRequest = snapshot.cooperationRequests.find((request) =>
    request.status === "pending" && request.playerDecisionAllowed
  );
  const completedProjects = snapshot.projects.filter((project) => project.status === "completed");
  const firstCompleted = completedProjects.some((project) =>
    project.definitionRef.stableId === "install-solar-array"
  );
  const secondProject = snapshot.projects.find((project) =>
    project.definitionRef.stableId === "install-second-array"
  );
  const secondStarted = secondProject !== undefined &&
    ["active", "blocked", "paused", "completed"].includes(secondProject.status) &&
    secondProject.steps.some((step) => step.workDone > 0);
  const tutorialFinished = firstCompleted && secondStarted;
  const allFinished = firstCompleted && secondProject?.status === "completed";
  const currentStep = activeProject?.steps.find((step) => step.status !== "completed") ?? null;
  const missingInputs = nextProject?.inputs?.filter((input) => {
    const item = snapshot.resources.find((resource) => resource.itemId === input.itemId);
    return (item?.quantity ?? 0) - (item?.reservedQuantity ?? 0) < input.quantity;
  }) ?? [];
  const inTransit = missingInputs.some((input) => snapshot.purchases.some((purchase) =>
    purchase.itemId === input.itemId && purchase.status === "in_transit"
  ));
  const deliveredOrder = snapshot.orders.find((order) => order.status === "delivered");
  const lastCompleted = completedProjects.at(-1);
  const arrivedPurchase = snapshot.purchases.find((purchase) => purchase.status === "delivered");
  const restoredRequest = snapshot.cooperationRequests.find((request) =>
    request.projectId === activeProject?.projectId && request.resolutionReason === "no_longer_needed"
  );
  const stage = pendingRequest ? 3 : activeProject
    ? completedProjects.length > 0 ? 6 : currentStep !== null && currentStep.index > 0 ? 3 : 2
    : completedProjects.length === 0 ? isPaused ? 1 : 2
    : !deliveredOrder ? 4 : missingInputs.length > 0 ? 5 : 6;
  const facts = [
    lastCompleted ? `${lastCompleted.name}已完工` : null,
    deliveredOrder ? `${deliveredOrder.name}已交付，取得 ${deliveredOrder.rewardCredits} credits` : null,
    arrivedPurchase ? `${arrivedPurchase.itemName}已到货` : null,
    restoredRequest ? "本组已恢复，支援请求已结案，无需再选择" : null
  ].filter((fact): fact is string => fact !== null);

  useEffect(() => {
    if (focusTarget.current === "detail" && hasSelection) {
      detailRef.current?.focus();
      focusTarget.current = null;
    } else if (focusTarget.current === "map" && !detailOpen) {
      mapRef.current?.focus();
      focusTarget.current = null;
    }
  }, [detailOpen, hasSelection, selectedSiteId, selectedProjectId, selectedDeviceId, selectedResourceId]);

  function selectAndShow(select: () => void) {
    focusTarget.current = "detail";
    setWorkspace("base");
    setDetailOpen(true);
    select();
  }

  const deviceSummary = snapshot.devices.map((device: BaseDeviceDto) => (
    <button
      key={device.deviceId}
      type="button"
      className={`base-device-chip${selectedDeviceId === device.deviceId ? " is-selected" : ""}`}
      aria-pressed={selectedDeviceId === device.deviceId}
      onClick={() => selectAndShow(() => onSelectDevice(device.deviceId))}
    >
      {device.name} · {ROBOT_STATUS_LABELS[device.status]}
    </button>
  ));

  return (
    <main className="base-shell">
      <section className="base-panel base-current-task" aria-label="当前目标">
        {tutorialFinished || allFinished ? (
          <div>
            <h2 className="base-panel-title">{allFinished ? "两项内测工程全部完工" : "本轮教程已完成"}</h2>
            <p className="base-copy">
              {allFinished
                ? "首轮经营闭环完成，两项内测工程均已完工。你可以回看基地和经营记录。"
                : "首轮经营闭环完成；第二阵列已有真实施工进度，尚未完工，可以继续观察。"}
            </p>
          </div>
        ) : activeProject ? (
          <div>
            <h2 className="base-panel-title">
              第 {stage}/6 段 · {activeProject.name}
            </h2>
            <p className="base-copy">
              {PROJECT_STATUS_LABELS[activeProject.status]}
              {currentStep
                ? ` · 当前步骤 ${currentStep.index + 1}/${activeProject.steps.length} ${STEP_KIND_LABELS[currentStep.kind]} ${currentStep.workDone}/${currentStep.workRequired}`
                : ""}
              {currentStep?.blockedReason ? ` · 受阻：${describeBlockedReason(currentStep.blockedReason)}` : ""}
              {isPaused ? " · 时间已暂停" : ""}
            </p>
          </div>
        ) : freeSite && nextProject ? (
          <div>
            <h2 className="base-panel-title">
              第 {stage}/6 段 · 当前目标 · {nextProject.name}
            </h2>
            <p className="base-copy">
              {completedProjects.length === 0
                ? `${nextProject.description}${missingInputs.length > 0 ? ` · 缺 ${missingInputs.length} 种材料，可在经营中采购` : ""}`
                : !deliveredOrder
                  ? "首工程已完成。查看可交付订单取得账款，再为下一阵列补料。"
                  : missingInputs.length > 0
                    ? inTransit ? "缺料中，相关采购在途；到货后核对剩余缺口。" : "下一阵列缺料，请核对账款并采购。"
                    : "材料已就绪，可以在空建设位开工。"}
            </p>
          </div>
        ) : (
          <div>
            <h2 className="base-panel-title">当前目标</h2>
            <p className="base-copy">查看已有项目、订单和基地状态，选择下一步。</p>
          </div>
        )}
        <div className="base-current-actions">
          {isPaused && canControl ? (
            <button type="button" className="base-primary-button" disabled={isBusy}
              onClick={() => onClockCommand({ command: "resume" }, "clock")}>恢复基地时间</button>
          ) : null}
          {!isPaused && canControl && snapshot.speed < 4 ? (
            <button type="button" className="base-primary-button" disabled={isBusy}
              onClick={() => onSetSpeed(4)}>速度 ×4</button>
          ) : null}
          {pendingRequest ? (
            <button type="button" className="base-primary-button" onClick={() => setWorkspace("cooperation")}>处理协作</button>
          ) : (tutorialFinished || allFinished) && secondProject ? (
            <button type="button" className="base-primary-button"
              onClick={() => selectAndShow(() => onSelectProject(secondProject.projectId))}>查看第二阵列</button>
          ) : activeProject ? (
            <button type="button" className="base-primary-button"
              onClick={() => selectAndShow(() => onSelectProject(activeProject.projectId))}>查看当前工程</button>
          ) : freeSite && nextProject && (completedProjects.length === 0 || missingInputs.length === 0) ? (
            <button type="button" className="base-primary-button"
              onClick={() => selectAndShow(() => onSelectSite(freeSite.siteId))}>前往{freeSite.name}</button>
          ) : (
            <button type="button" className="base-primary-button" onClick={() => setWorkspace("economy")}>查看订单与补给</button>
          )}
        </div>
        {facts.length > 0 ? <p className="base-current-facts">当前记录：{facts.join(" · ")}</p> : null}
      </section>

      <nav className="base-workspace-nav" aria-label="基地工作区">
        {([
          ["base", "基地"],
          ["economy", "经营"],
          ["manufacturing", "制造"],
          ["cooperation", activeRequests > 0 ? `协作 · ${activeRequests}` : "协作"]
        ] as const).map(([area, label]) => (
          <button key={area} type="button" aria-pressed={workspace === area}
            onClick={() => setWorkspace(area)}>{label}</button>
        ))}
      </nav>

      <header className="base-panel base-topbar" aria-label="基地状态总览">
        <h1 className="base-panel-title">
          {snapshot.name || "火星先遣基地"}
          <small className="base-credit-summary">账款 {snapshot.credits} credits</small>
        </h1>
        <details className="base-summary base-drawer" aria-label="电力">
          <summary>电力 · 可用 {kw(snapshot.power.availableW)} kW · 储能 {kwh(snapshot.power.storageWh)} kWh</summary>
          <div className="base-power-details">
          <p className="base-summary-line">发电能力 {kw(snapshot.power.generationWPeak)} kW</p>
          <p className="base-summary-line">当前可用 {kw(snapshot.power.availableW)} kW</p>
          <p className="base-summary-line">
            储能 {kwh(snapshot.power.storageWh)}/{kwh(snapshot.power.storageCapacityWh)} kWh
          </p>
          <p className="base-summary-line">负载 {kw(snapshot.power.loadW)} kW</p>
          </div>
        </details>

        <details className="base-summary base-drawer" aria-label="物资">
          <summary>物资 · {snapshot.resources.length} 种</summary>
          {snapshot.resources.length === 0 ? (
            <p className="base-copy">仓库是空的。</p>
          ) : (
            <ul className="base-resource-list">
              {snapshot.resources.map((resource) => (
                <li key={resource.itemId}>
                  <button
                    type="button"
                    className="base-resource-chip"
                    aria-pressed={selectedResourceId === resource.itemId}
                    onClick={() => {
                      if (selectedResourceId === resource.itemId) {
                        setDetailOpen(false);
                        onSelectResource(resource.itemId);
                      } else {
                        selectAndShow(() => onSelectResource(resource.itemId));
                      }
                    }}
                  >
                    {resource.name} · 可支配 ×{resource.quantity - resource.reservedQuantity}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </details>

        <details className="base-summary base-drawer" aria-label="设备">
          <summary>设备 · {fleetStatus(snapshot)}</summary>
          {snapshot.devices.length === 0 ? (
            <p className="base-copy">还没有设备。</p>
          ) : (
            <div className="base-device-chips">{deviceSummary}</div>
          )}
        </details>

        <section className="base-summary base-clock" aria-label="基地时间">
          <h2 className="base-panel-title">时间</h2>
          {isPaused ? (
            <>
              <strong className="base-paused-badge" role="status">
                时间已暂停
              </strong>
              <p className="base-summary-line base-pause-note">暂停期间不消耗物资；恢复后重新检查工程条件。</p>
            </>
          ) : (
            <p className="base-summary-line">
              {canControl
                ? `计时中 · 速度 ×${snapshot.speed}`
                : controlActive ? "其他标签页正在控制基地" : "未获前台控制，基地时间不推进"}
            </p>
          )}
          <p className="base-summary-line base-simtime">{formatSimClock(snapshot.simTime)}</p>
          <div className="base-speed-row" role="group" aria-label="时间流速">
            {[1, 2, 4].map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={!isPaused && snapshot.speed === speed}
                disabled={isBusy || csrfToken === null || !canControl}
                onClick={() => onSetSpeed(speed)}
              >
                ×{speed}
              </button>
            ))}
          </div>
          <div className="base-clock-actions">
            {!canControl && csrfToken && onAcquireControl ? (
              <button type="button" className="base-primary-button" disabled={isBusy}
                onClick={onAcquireControl}>接管基地</button>
            ) : null}
            <button
              type="button"
              className="base-primary-button"
              disabled={isBusy || csrfToken === null || !canControl}
              onClick={() => onClockCommand(isPaused ? { command: "resume" } : { command: "pause" })}
            >
              {isPaused ? "恢复计时" : "暂停计时"}
            </button>
            {accountEmail ? (
              <span className="base-account-email" title={accountEmail}>
                {accountEmail}
              </span>
            ) : null}
            <button type="button" className="base-logout-button" onClick={onLogout}>
              退出登录
            </button>
          </div>
          <ActionFeedback area="clock" feedback={actionFeedback} />
        </section>
      </header>

      <section className="base-workspace" hidden={workspace !== "base"} aria-label="基地主场景">
        <div className={`base-scene${detailOpen && hasSelection ? " show-detail" : ""}`}>
          <div className="base-map-wrap" ref={mapRef} tabIndex={-1}>
            <BaseMap sites={snapshot.sites} projects={snapshot.projects}
              selectedSiteId={selectedSiteId}
              onSelectSite={(siteId) => selectAndShow(() => onSelectSite(siteId))}
            />
          </div>
          <div className="base-detail-wrap" ref={detailRef} tabIndex={-1}>
            <div className="base-back-row">
              <button type="button" className="base-link-button" onClick={() => {
                focusTarget.current = "map";
                setDetailOpen(false);
              }}>返回地图</button>
            </div>
            <ActionFeedback area="base" feedback={actionFeedback} />
            <ObjectPanel
              sites={snapshot.sites}
              projects={snapshot.projects}
              devices={sortedDevices(snapshot.devices)}
              buildableProjects={snapshot.buildableProjects}
              resources={snapshot.resources}
              purchases={snapshot.purchases}
              selectedResourceId={selectedResourceId}
              selectedSiteId={selectedSiteId}
              selectedProjectId={selectedProjectId}
              selectedDeviceId={selectedDeviceId}
              timeMode={snapshot.timeMode}
              isBusy={isBusy}
              onSelectProject={(projectId) => selectAndShow(() => onSelectProject(projectId))}
              onCreateProject={onCreateProject}
              onCancelProject={onCancelProject}
              onResume={() => onClockCommand({ command: "resume" }, "base")}
            />
          </div>
        </div>
        {snapshot.projects.length > 0 ? (
          <ProjectBoard projects={snapshot.projects}
            buildableProjects={snapshot.buildableProjects}
            selectedProjectId={selectedProjectId}
            onSelectProject={(projectId) => selectAndShow(() => onSelectProject(projectId))}
            devices={snapshot.devices} timeMode={snapshot.timeMode}
          />
        ) : null}
      </section>

      <section className="base-workspace" hidden={workspace !== "economy"} aria-label="经营工作区">
        <ActionFeedback area="economy" feedback={actionFeedback} />
        <EconomyBoard credits={snapshot.credits} orders={snapshot.orders}
          purchases={snapshot.purchases} resources={snapshot.resources}
          targetProject={!activeProject && freeSite ? nextProject : undefined}
          simTime={snapshot.simTime}
          isBusy={isBusy} onAcceptOrder={onAcceptOrder}
          onDeliverOrder={onDeliverOrder} onPurchase={onPurchase}
        />
      </section>
      <section className="base-workspace" hidden={workspace !== "manufacturing"} aria-label="制造工作区">
        <ActionFeedback area="manufacturing" feedback={actionFeedback} />
        <ManufacturingBoard jobs={snapshot.manufacturingJobs}
          recipes={snapshot.availableRecipes} resources={snapshot.resources}
          purchases={snapshot.purchases} isBusy={isBusy}
          selectedJobId={selectedJobId} onSelectJob={onSelectJob}
          onCreateJob={onCreateJob} onCancelJob={onCancelJob}
        />
      </section>
      <section className="base-workspace" hidden={workspace !== "cooperation"} aria-label="协作工作区">
        <CooperationPanel requests={snapshot.cooperationRequests} devices={snapshot.devices}
          isBusy={isBusy} {...(onCooperationDecision ? { onDecision: onCooperationDecision } : {})}
          feedback={actionFeedback?.area === "cooperation" ? actionFeedback : null} />
      </section>
    </main>
  );
}

function ActionFeedback({ area, feedback }: {
  area: BaseActionFeedback["area"];
  feedback: BaseActionFeedback | null;
}) {
  if (feedback?.area !== area) return null;
  return <p className="base-task-feedback" role={feedback.kind === "error" ? "alert" : "status"}>
    {feedback.message}
  </p>;
}

// 基地时间显示：simTime 的 UTC 小时即基地昼夜基准（与结算规则一致）。
function formatSimClock(simTime: string): string {
  const date = new Date(simTime);
  if (Number.isNaN(date.getTime())) return simTime;
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const phase = date.getUTCHours() >= 6 && date.getUTCHours() < 18 ? "昼间" : "夜间 · 储能供电";
  return `基地时间 ${hh}:${mm} · ${phase}`;
}

// 设备区排序：编组（运输→工程→勘测）内按作业状态优先（作业中 > 充电 > 待命 > 离线）。
const GROUP_ORDER: Record<string, number> = { transport: 0, engineering: 1, survey: 2 };
const STATUS_ORDER: Record<string, number> = { working: 0, charging: 1, idle: 2, offline: 3 };

function sortedDevices(devices: BaseDeviceDto[]): BaseDeviceDto[] {
  return [...devices].sort(
    (a, b) =>
      (GROUP_ORDER[a.groupId] ?? 9) - (GROUP_ORDER[b.groupId] ?? 9) ||
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      a.name.localeCompare(b.name, "zh-Hans-CN")
  );
}

// 工程队状态一句话：作业中/充电中/待命台数——让页面在等待期也有"活着"的反馈。
function fleetStatus(snapshot: BaseSnapshotDto): string {
  if (snapshot.devices.length === 0) return "工程队：暂无设备";
  const working = snapshot.devices.filter((device) => device.status === "working").length;
  const charging = snapshot.devices.filter((device) => device.status === "charging").length;
  const idle = snapshot.devices.filter((device) => device.status === "idle").length;
  const parts: string[] = [];
  if (working > 0) parts.push(`${working} 台作业中`);
  if (charging > 0) parts.push(`${charging} 台充电`);
  if (idle > 0) parts.push(`${idle} 台待命`);
  return parts.length > 0 ? `工程队：${parts.join("、")}` : `工程队：${snapshot.devices.length} 台离线`;
}
