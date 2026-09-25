import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BaseDeviceDto,
  BaseProjectDto,
  BaseSiteDto
} from "@ai-mud/shared";
import { ObjectPanel } from "./ObjectPanel.js";

const sites: BaseSiteDto[] = [
  { siteId: "site-a", name: "测试站点", siteKey: "site_a", state: "free", note: null, description: null, attributes: [] },
  { siteId: "site-b", name: "测试站点", siteKey: "site_b", state: "reserved", note: null, description: null, attributes: [] }
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
        purchases={[]}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, reservedQuantity: 0, reservationSources: [], description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId={null}
        selectedProjectId={null}
        selectedDeviceId={null}
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={noop}
        onCancelProject={noop}
        timeMode="running"
        onResume={noop}
      />
    );

    expect(screen.getByText(/点击地图上的地点/)).toBeTruthy();
  });

  it("选中空地时显示开工材料清单与库存缺口（BUILD-01）", () => {
    render(
      <ObjectPanel
        sites={sites}
        projects={projects}
        devices={devices}
        purchases={[]}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, reservedQuantity: 0, reservationSources: [], description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId="site-a"
        selectedProjectId={null}
        selectedDeviceId={null}
        buildableProjects={[
          {
            definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
            name: "安装太阳电池阵",
            description: "把运抵的太阳电池阵安装到建设位并并网。",
            inputs: [
              { itemId: "solar_panel_set", quantity: 6 },
              { itemId: "spare_parts", quantity: 4 }
            ]
          }
        ]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={noop}
        onCancelProject={noop}
        timeMode="running"
        onResume={noop}
      />
    );

    expect(screen.getByText(/太阳电池阵组件 ×6.*可支配 0.*缺 6/)).toBeTruthy();
    expect(screen.getByText(/通用备件 ×4.*可支配 30/)).toBeTruthy();
    expect(screen.queryByText(/，缺/)).toBeTruthy();
  });

  it("总量已被工程占用时显示可支配缺口、来源和未入库在途", () => {
    const anchor = {
      itemId: "anchor", name: "锚固件", quantity: 8, reservedQuantity: 8,
      reservationSources: [{ kind: "project" as const, id: "project-live", name: "安装太阳能阵列", quantity: 8 }],
      description: "地基材料"
    };
    const purchases = [{
      purchaseId: "purchase-1", itemId: "anchor", itemName: "锚固件", quantity: 3,
      costCredits: 30, status: "in_transit" as const, arrivesAtSim: "2126-01-01T12:00:00.000Z"
    }];
    const props = {
      sites, projects, devices, resources: [anchor], purchases,
      selectedResourceId: "anchor", selectedSiteId: null, selectedProjectId: null,
      selectedDeviceId: null, timeMode: "running" as const, isBusy: false,
      buildableProjects: [{
        definitionRef: { kind: "project" as const, stableId: "solar", revision: 1 },
        name: "第二太阳能阵列", description: "扩建", inputs: [{ itemId: "anchor", quantity: 3 }]
      }],
      onSelectProject: noop, onCreateProject: noop, onCancelProject: noop, onResume: noop
    };
    const view = render(<ObjectPanel {...props} />);
    expect(screen.getByText("库存总量：×8")).toBeTruthy();
    expect(screen.getByText("已占用：×8")).toBeTruthy();
    expect(screen.getByText("可支配：×0")).toBeTruthy();
    expect(screen.getByText(/工程「安装太阳能阵列」占用 ×8/)).toBeTruthy();
    expect(screen.getByText(/在途：×3（到货前不可支配）/)).toBeTruthy();

    view.rerender(<ObjectPanel {...props} selectedResourceId={null} selectedSiteId="site-a" />);
    expect(screen.getByText(/锚固件 ×3.*可支配 0.*缺 3.*在途 3/)).toBeTruthy();
    expect(screen.getByText(/占用去向：工程「安装太阳能阵列」×8/)).toBeTruthy();
  });

  it("选中空地时列出可建项目，点击建设按钮上报含 uuid 的命令参数", () => {
    const onCreateProject = vi.fn();
    render(
      <ObjectPanel
        sites={sites}
        projects={projects}
        devices={devices}
        purchases={[]}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, reservedQuantity: 0, reservationSources: [], description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId="site-a"
        selectedProjectId={null}
        selectedDeviceId={null}
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={onCreateProject}
        onCancelProject={noop}
        timeMode="running"
        onResume={noop}
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

  it("暂停项目在现场说明原因并能恢复，同时保留步骤受阻信息", () => {
    const onResume = vi.fn();
    render(
      <ObjectPanel
        sites={sites}
        projects={[{ ...projects[0]!, status: "blocked" }]}
        devices={devices}
        purchases={[]}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, reservedQuantity: 0, reservationSources: [], description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId={null}
        selectedProjectId="project-live"
        selectedDeviceId={null}
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={noop}
        onCancelProject={noop}
        timeMode="paused"
        onResume={onResume}
      />
    );

    expect(screen.getByText("设备安装 · 受阻")).toBeTruthy();
    expect(screen.getByText("工作量 10/80")).toBeTruthy();
    expect(screen.getByText("受阻：供电不足")).toBeTruthy();
    expect(screen.getByText(/基地时间已暂停，此项目不会推进/)).toBeTruthy();
    expect(screen.getByText(/恢复计时后仍需解决受阻条件/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复计时" }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("取消项目必须先确认，确认后才上报", () => {
    const onCancelProject = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <ObjectPanel
        sites={sites}
        projects={projects}
        devices={devices}
        purchases={[]}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, reservedQuantity: 0, reservationSources: [], description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId={null}
        selectedProjectId="project-live"
        selectedDeviceId={null}
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={noop}
        onCancelProject={onCancelProject}
        timeMode="running"
        onResume={noop}
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
        purchases={[]}
        resources={[{ itemId: "spare_parts", name: "通用备件", quantity: 30, reservedQuantity: 0, reservationSources: [], description: "维修耗材" }]}
        selectedResourceId={null}
        selectedSiteId={null}
        selectedProjectId={null}
        selectedDeviceId="device-1"
        buildableProjects={[{ definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }, name: "安装太阳电池阵", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        isBusy={false}
        onSelectProject={noop}
        onCreateProject={noop}
        onCancelProject={noop}
        timeMode="running"
        onResume={noop}
      />
    );

    expect(screen.getByText("状态：充电中")).toBeTruthy();
    expect(screen.getByText("电量：6000/30000 Wh（约 20%）")).toBeTruthy();
    expect(screen.getByText("当前任务：安装太阳能阵列（设备安装）")).toBeTruthy();
  });
});
