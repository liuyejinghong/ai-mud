// 基地主壳：四区布局。只转发快照与回调，自己不发任何请求。
import type {
  BaseClockCommandInputDto,
  BaseDeviceDto,
  BaseSnapshotDto,
  CreateProjectInputDto,
  RobotStatus
} from "@ai-mud/shared";
import { BaseMap } from "./BaseMap.js";
import { ObjectPanel } from "./ObjectPanel.js";
import { ProjectBoard } from "./ProjectBoard.js";
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

export interface BaseShellProps {
  snapshot: BaseSnapshotDto;
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
  onClockCommand: (input: BaseClockCommandInputDto) => void;
}

export function BaseShell({
  snapshot,
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
  onClockCommand
}: BaseShellProps) {
  const isPaused = snapshot.timeMode === "paused";
  const deviceSummary = snapshot.devices.map((device: BaseDeviceDto) => (
    <button
      key={device.deviceId}
      type="button"
      className={`base-device-chip${selectedDeviceId === device.deviceId ? " is-selected" : ""}`}
      aria-pressed={selectedDeviceId === device.deviceId}
      onClick={() => onSelectDevice(device.deviceId)}
    >
      {device.name} · {ROBOT_STATUS_LABELS[device.status]}
    </button>
  ));

  return (
    <main className="base-shell">
      <header className="base-panel base-topbar" aria-label="基地状态总览">
        <section className="base-summary" aria-label="电力">
          <h2 className="base-panel-title">电力</h2>
          <p className="base-summary-line">发电能力 {kw(snapshot.power.generationWPeak)} kW</p>
          <p className="base-summary-line">当前可用 {kw(snapshot.power.availableW)} kW</p>
          <p className="base-summary-line">
            储能 {kwh(snapshot.power.storageWh)}/{kwh(snapshot.power.storageCapacityWh)} kWh
          </p>
          <p className="base-summary-line">负载 {kw(snapshot.power.loadW)} kW</p>
        </section>

        <section className="base-summary" aria-label="物资">
          <h2 className="base-panel-title">物资</h2>
          {snapshot.resources.length === 0 ? (
            <p className="base-copy">仓库是空的。</p>
          ) : (
            <ul className="base-resource-list">
              {snapshot.resources.map((resource) => (
                <li key={resource.itemId}>
                  {resource.name} ×{resource.quantity}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="base-summary" aria-label="设备">
          <h2 className="base-panel-title">设备</h2>
          {snapshot.devices.length === 0 ? (
            <p className="base-copy">还没有设备。</p>
          ) : (
            <div className="base-device-chips">{deviceSummary}</div>
          )}
        </section>

        <section className="base-summary base-clock" aria-label="基地时间">
          <h2 className="base-panel-title">时间</h2>
          {isPaused ? (
            <strong className="base-paused-badge" role="status">
              时间已暂停
            </strong>
          ) : (
            <p className="base-summary-line">
              计时中 · 速度 ×{snapshot.speed}
            </p>
          )}
          <p className="base-summary-line base-simtime">{snapshot.simTime}</p>
          <button
            type="button"
            className="base-primary-button"
            disabled={isBusy || csrfToken === null}
            onClick={() => onClockCommand(isPaused ? { command: "resume" } : { command: "pause" })}
          >
            {isPaused ? "恢复计时" : "暂停计时"}
          </button>
        </section>
      </header>

      <BaseMap
        sites={snapshot.sites}
        projects={snapshot.projects}
        selectedSiteId={selectedSiteId}
        onSelectSite={onSelectSite}
      />

      <ObjectPanel
        sites={snapshot.sites}
        projects={snapshot.projects}
        devices={snapshot.devices}
        buildableProjects={snapshot.buildableProjects}
        selectedSiteId={selectedSiteId}
        selectedProjectId={selectedProjectId}
        selectedDeviceId={selectedDeviceId}
        isBusy={isBusy}
        onSelectProject={onSelectProject}
        onCreateProject={onCreateProject}
        onCancelProject={onCancelProject}
      />

      <ProjectBoard
        projects={snapshot.projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={onSelectProject}
      />
    </main>
  );
}
