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
  onClockCommand: (input: BaseClockCommandInputDto) => void;
  onSetSpeed: (speed: number) => void;
  onSelectResource: (itemId: string) => void;
  onLogout: () => void;
}

export function BaseShell({
  snapshot,
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
  onLogout
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
        <h1 className="base-panel-title">{snapshot.name || "火星先遣基地"}</h1>
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
                  <button
                    type="button"
                    className="base-resource-chip"
                    aria-pressed={selectedResourceId === resource.itemId}
                    onClick={() => onSelectResource(resource.itemId)}
                  >
                    {resource.name} ×{resource.quantity}
                  </button>
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
            <>
              <strong className="base-paused-badge" role="status">
                时间已暂停
              </strong>
              <p className="base-summary-line">暂停期间不消耗物资，恢复后继续施工。</p>
            </>
          ) : (
            <p className="base-summary-line">
              计时中 · 速度 ×{snapshot.speed}
            </p>
          )}
          <p className="base-summary-line">{fleetStatus(snapshot)}</p>
          <p className="base-summary-line base-simtime">{formatSimClock(snapshot.simTime)}</p>
          <div className="base-speed-row" role="group" aria-label="时间流速">
            {[1, 2, 4].map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={!isPaused && snapshot.speed === speed}
                disabled={isBusy || csrfToken === null}
                onClick={() => onSetSpeed(speed)}
              >
                ×{speed}
              </button>
            ))}
          </div>
          <div className="base-clock-actions">
            <button
              type="button"
              className="base-primary-button"
              disabled={isBusy || csrfToken === null}
              onClick={() => onClockCommand(isPaused ? { command: "resume" } : { command: "pause" })}
            >
              {isPaused ? "恢复计时" : "暂停计时"}
            </button>
            <button type="button" className="base-logout-button" onClick={onLogout}>
              退出登录
            </button>
          </div>
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
        devices={sortedDevices(snapshot.devices)}
        buildableProjects={snapshot.buildableProjects}
        resources={snapshot.resources}
        selectedResourceId={selectedResourceId ?? null}
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
        buildableProjects={snapshot.buildableProjects}
        selectedProjectId={selectedProjectId}
        onSelectProject={onSelectProject}
      />
    </main>
  );
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
  const working = snapshot.devices.filter((device) => device.status === "working").length;
  const charging = snapshot.devices.filter((device) => device.status === "charging").length;
  const idle = snapshot.devices.filter((device) => device.status === "idle").length;
  const parts: string[] = [];
  if (working > 0) parts.push(`${working} 台作业中`);
  if (charging > 0) parts.push(`${charging} 台充电`);
  if (idle > 0) parts.push(`${idle} 台待命`);
  return parts.length > 0 ? `工程队：${parts.join("、")}` : "工程队：12 台就位";
}
