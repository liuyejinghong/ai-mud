import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BaseDeviceDto,
  BaseProjectDto,
  BaseSiteDto
} from "@ai-mud/shared";
import { ObjectPanel } from "./ObjectPanel.js";

const sites: BaseSiteDto[] = [
  { siteId: "site-a", name: "测试站点", siteKey: "site_a", state: "free", description: null, attributes: [] },
  { siteId: "site-b", name: "测试站点", siteKey: "site_b", state: "reserved", description: null, attributes: [] }
];

const projects: BaseProjectDto[] = [
  {
    projectId: "project-live",
    definitionRef: { kind: "project", stableId: "install_solar_array", revision: 3 },
    name: "安装太阳能阵列",
    status: "active",
    siteId: "site-b",
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
        kind: "installation",
        groupId: "engineering",
        status: "blocked",
        workRequired: 80,
        workDone: 10,
        blockedReason: "insufficient_power"
      }
    ]
  }
];

const devices: BaseDeviceDto[] = [
  {
    deviceId: "device-1",
    operatorId: "operator-1",
    name: "筑垒者一号",
    groupId: "engineering",
    description: "测试设备说明",
    status: "charging",
    batteryWh: 6000,
    batteryCapacityWh: 30000,
    currentAssignment: { projectId: "project-live", stepIndex: 1 }
  }
];

const noop = () => undefined;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ObjectPanel", () => {
  it("未选中任何对象时给出引导文案", () => {
    render(
      <ObjectPanel
        sites={sites}
        projects={projects}
        devices={devices}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId={null}
        selectedProjectId={null}
        selectedDeviceId={null}
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={noop}
        onCancelProject={noop}
      />
    );

    expect(screen.getByText(/点击地图上的地点/)).toBeTruthy();
  });

  it("选中空地时列出可建项目，点击建设按钮上报含 uuid 的命令参数", () => {
    const onCreateProject = vi.fn();
    render(
      <ObjectPanel
        sites={sites}
        projects={projects}
        devices={devices}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId="site-a"
        selectedProjectId={null}
        selectedDeviceId={null}
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={onCreateProject}
        onCancelProject={noop}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "在这里建设" }));

    expect(onCreateProject).toHaveBeenCalledOnce();
    const input = onCreateProject.mock.calls[0]?.[0] as {
      definitionRef: unknown;
      siteId: string;
      commandId: string;
    };
    expect(input.siteId).toBe("site-a");
    expect(input.definitionRef).toEqual({
      kind: "project",
      stableId: "install_solar_array",
      revision: 1
    });
    expect(input.commandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("选中项目时显示步骤与受阻原因", () => {
    render(
      <ObjectPanel
        sites={sites}
        projects={projects}
        devices={devices}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId={null}
        selectedProjectId="project-live"
        selectedDeviceId={null}
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={noop}
        onCancelProject={noop}
      />
    );

    expect(screen.getByText("设备安装 · 受阻")).toBeTruthy();
    expect(screen.getByText("工作量 10/80")).toBeTruthy();
    expect(screen.getByText("受阻：供电不足")).toBeTruthy();
  });

  it("取消项目必须先确认，确认后才上报", () => {
    const onCancelProject = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <ObjectPanel
        sites={sites}
        projects={projects}
        devices={devices}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId={null}
        selectedProjectId="project-live"
        selectedDeviceId={null}
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={noop}
        onCancelProject={onCancelProject}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "取消项目" }));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0]?.[0]).toContain("退还");
    expect(onCancelProject).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "取消项目" }));
    expect(onCancelProject).toHaveBeenCalledWith("project-live");
  });

  it("选中设备时显示电量、状态与当前任务", () => {
    render(
      <ObjectPanel
        sites={sites}
        projects={projects}
        devices={devices}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId={null}
        selectedProjectId={null}
        selectedDeviceId="device-1"
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={noop}
        onCancelProject={noop}
      />
    );

    expect(screen.getByText("状态：充电中")).toBeTruthy();
    expect(screen.getByText("电量：6000/30000 Wh（约 20%）")).toBeTruthy();
    expect(screen.getByText("当前任务：安装太阳能阵列（设备安装）")).toBeTruthy();
  });
});
