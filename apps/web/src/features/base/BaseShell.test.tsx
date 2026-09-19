import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import { BaseShell } from "./BaseShell.js";

function buildSnapshot(overrides: Partial<BaseSnapshotDto> = {}): BaseSnapshotDto {
  return {
    baseId: "base-1",
    epoch: 1,
    baseRevision: 1,
    simTime: "2126-01-01T08:00:00.000Z",
    timeMode: "running",
    speed: 1,
    activeContentRelease: "default-release",
    power: {
      generationWPeak: 13500,
      availableW: 12500,
      storageWh: 100000,
      storageCapacityWh: 200000,
      loadW: 1000
    },
    resources: [
      { itemId: "solar_panel_set", name: "太阳能板组", quantity: 6 },
      { itemId: "anchor", name: "地锚", quantity: 8 }
    ],
    sites: [
      { siteId: "site-array", siteKey: "array", state: "built" },
      { siteId: "site-a", siteKey: "site_a", state: "free" }
    ],
    devices: [
      {
        deviceId: "device-1",
        operatorId: "operator-1",
        name: "驮运者一号",
        groupId: "transport",
        status: "working",
        batteryWh: 12000,
        batteryCapacityWh: 20000,
        currentAssignment: null
      }
    ],
    projects: [
      {
        projectId: "project-1",
        definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
        name: "安装太阳能阵列",
        status: "active",
        siteId: "site-a",
        steps: [
          {
            index: 0,
            kind: "site_clearing",
            groupId: "engineering",
            status: "completed",
            workRequired: 40,
            workDone: 40,
            blockedReason: null
          },
          {
            index: 1,
            kind: "transport",
            groupId: "transport",
            status: "running",
            workRequired: 60,
            workDone: 30,
            blockedReason: null
          }
        ]
      }
    ],
    buildableProjects: [],
  controlLease: { heldByThisSession: true, leaseUntil: "2126-01-01T08:02:00.000Z" },
    ...overrides
  };
}

const noop = () => undefined;

function renderShell(snapshot: BaseSnapshotDto) {
  return render(
    <BaseShell
      snapshot={snapshot}
      csrfToken="csrf-1"
      selectedSiteId={null}
      selectedProjectId={null}
      selectedDeviceId={null}
      isBusy={false}
      onSelectSite={noop}
      onSelectProject={noop}
      onSelectDevice={noop}
      onCreateProject={noop}
      onCancelProject={noop}
      onClockCommand={noop}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("BaseShell", () => {
  it("渲染四区布局，并把 W/Wh 换算成一位小数的 kW/kWh", () => {
    renderShell(buildSnapshot());

    expect(screen.getByLabelText("基地状态总览")).toBeTruthy();
    expect(screen.getByLabelText("基地地图")).toBeTruthy();
    expect(screen.getByLabelText("对象详情")).toBeTruthy();
    expect(screen.getByLabelText("项目清单")).toBeTruthy();

    expect(screen.getByText("发电能力 13.5 kW")).toBeTruthy();
    expect(screen.getByText("当前可用 12.5 kW")).toBeTruthy();
    expect(screen.getByText("储能 100.0/200.0 kWh")).toBeTruthy();
    expect(screen.getByText("负载 1.0 kW")).toBeTruthy();
  });

  it("暂停时显示醒目徽标并提供恢复按钮", () => {
    renderShell(buildSnapshot({ timeMode: "paused" }));

    expect(screen.getByText("时间已暂停")).toBeTruthy();
    expect(screen.getByRole("button", { name: "恢复计时" })).toBeTruthy();
  });

  it("计时时显示速度并提供暂停按钮", () => {
    const onClockCommand = vi.fn();
    render(
      <BaseShell
        snapshot={buildSnapshot({ timeMode: "running", speed: 2 })}
        csrfToken="csrf-1"
        selectedSiteId={null}
        selectedProjectId={null}
        selectedDeviceId={null}
        isBusy={false}
        onSelectSite={noop}
        onSelectProject={noop}
        onSelectDevice={noop}
        onCreateProject={noop}
        onCancelProject={noop}
        onClockCommand={onClockCommand}
      />
    );

    expect(screen.queryByText("时间已暂停")).toBeNull();
    expect(screen.getByText("计时中 · 速度 ×2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "暂停计时" }));
    expect(onClockCommand).toHaveBeenCalledWith({ command: "pause" });
  });

  it("点击顶部设备芯片时上报设备选择", () => {
    const onSelectDevice = vi.fn();
    render(
      <BaseShell
        snapshot={buildSnapshot()}
        csrfToken="csrf-1"
        selectedSiteId={null}
        selectedProjectId={null}
        selectedDeviceId={null}
        isBusy={false}
        onSelectSite={noop}
        onSelectProject={noop}
        onSelectDevice={onSelectDevice}
        onCreateProject={noop}
        onCancelProject={noop}
        onClockCommand={noop}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /驮运者一号 · 作业中/ }));
    expect(onSelectDevice).toHaveBeenCalledWith("device-1");
  });
});
