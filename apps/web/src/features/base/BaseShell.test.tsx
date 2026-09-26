import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import { useState } from "react";
import { BaseShell } from "./BaseShell.js";
import type { BaseShellProps } from "./BaseShell.js";

function buildSnapshot(overrides: Partial<BaseSnapshotDto> = {}): BaseSnapshotDto {
  return {
    name: "先遣前哨",
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
      { itemId: "solar_panel_set", name: "太阳能板组", quantity: 6, reservedQuantity: 0, reservationSources: [], description: "测试物资说明" },
      { itemId: "anchor", name: "地锚", quantity: 8, reservedQuantity: 0, reservationSources: [], description: "测试物资说明" }
    ],
    sites: [
      { siteId: "site-array", name: "测试站点", siteKey: "array", state: "built", note: null, description: null, attributes: [] },
      { siteId: "site-a", name: "测试站点", siteKey: "site_a", state: "free", note: null, description: null, attributes: [] }
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
        currentAssignment: null, description: "测试设备说明" }
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
    manufacturingJobs: [],
    availableRecipes: [],
    cooperationRequests: [],
    credits: 500,
    orders: [],
    purchases: [],
    weather: {
      current: "clear",
      lightFactor: 1.0,
      dustLevel: 30,
      nextChangeAt: "2126-01-01T20:00:00.000Z",
      nextWeather: "warning"
    },
    controlLease: { heldByThisSession: true, controlActive: true, leaseUntil: "2126-01-01T08:02:00.000Z" },
    ...overrides
  };
}

const noop = () => undefined;

function shellProps(snapshot: BaseSnapshotDto): BaseShellProps {
  return {
    snapshot,
    csrfToken: "csrf-1",
    selectedSiteId: null,
    selectedProjectId: null,
    selectedDeviceId: null,
    selectedResourceId: null,
    selectedJobId: null,
    isBusy: false,
    onSelectSite: noop,
    onSelectProject: noop,
    onSelectDevice: noop,
    onSelectResource: noop,
    onSelectJob: noop,
    onCreateProject: noop,
    onCancelProject: noop,
    onCreateJob: noop,
    onCancelJob: noop,
    onAcceptOrder: noop,
    onDeliverOrder: noop,
    onPurchase: noop,
    onSetSpeed: noop,
    onClockCommand: noop,
    onLogout: noop
  };
}

function renderShell(snapshot: BaseSnapshotDto) {
  return render(<BaseShell {...shellProps(snapshot)} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("BaseShell", () => {
  it("首屏先给当前步骤与动作，失去控制权时禁用时钟命令", () => {
    const snapshot = buildSnapshot({
      controlLease: { heldByThisSession: false, controlActive: false, leaseUntil: null },
      cooperationRequests: [{
        requestId: "request-1", projectId: "project-1", projectName: "安装太阳能阵列",
        stepIndex: 1, fromGroupId: "engineering", helperGroupId: "transport",
        status: "pending", resolutionReason: null, helperOperatorId: null,
        playerDecisionAllowed: true, proposedHelper: null,
        question: "运输组缺工", createdAt: "2126-01-01T08:00:00.000Z"
      }]
    });
    const { container } = renderShell(snapshot);

    expect(container.querySelector("main.base-shell")?.firstElementChild?.getAttribute("aria-label"))
      .toBe("当前目标");
    expect(screen.getByText(/当前步骤.*物资运输.*30\/60/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /处理协作/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "暂停计时" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("首工程完成后从订单与在途事实推导补给目标", () => {
    renderShell(buildSnapshot({
      projects: [{
        projectId: "project-1", definitionRef: { kind: "project", stableId: "install-solar-array", revision: 1 },
        name: "首座太阳阵列", status: "completed", siteId: "site-a", steps: []
      }],
      buildableProjects: [{
        definitionRef: { kind: "project", stableId: "install-second-array", revision: 1 },
        name: "第二阵列", description: "继续扩大发电能力",
        inputs: [{ itemId: "solar_panel_set", quantity: 12 }]
      }],
      orders: [{
        orderId: "order-1", orderRef: { kind: "order", stableId: "spares", revision: 1 },
        name: "备件采购单", status: "delivered", requiredItemId: "spare_parts", requiredItemName: "备件",
        quantity: 10, rewardCredits: 450, deadlineSim: null, acceptedAtSim: null
      }],
      purchases: [{
        purchaseId: "purchase-1", itemId: "solar_panel_set", itemName: "太阳能板组", quantity: 6,
        costCredits: 720, status: "in_transit", arrivesAtSim: "2126-01-01T08:20:00.000Z"
      }]
    }));

    expect(screen.getByRole("heading", { name: /第 5\/6 段 · 当前目标 · 第二阵列/ })).toBeTruthy();
    expect(screen.getByText(/相关采购在途/)).toBeTruthy();
    expect(screen.getByText(/首座太阳阵列已完工.*备件采购单已交付/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看订单与补给" })).toBeTruthy();
  });

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

  it("页首时间命令失败在时间控制旁提示，地图视图不吞掉反馈", () => {
    render(<BaseShell {...shellProps(buildSnapshot())}
      actionFeedback={{ area: "clock", kind: "error", message: "无法恢复计时" }} />);
    expect(within(screen.getByLabelText("基地时间")).getByRole("alert").textContent)
      .toBe("无法恢复计时");
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
        onLogout={() => undefined}
        onCreateJob={() => undefined}
        onCancelJob={() => undefined}
        onAcceptOrder={() => undefined}
        onDeliverOrder={() => undefined}
        onPurchase={() => undefined}
        onSelectJob={() => undefined}
        selectedJobId={null}
        onSelectResource={() => undefined}
        selectedResourceId={null}
        onSetSpeed={() => undefined}
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
        onLogout={() => undefined}
        onCreateJob={() => undefined}
        onCancelJob={() => undefined}
        onAcceptOrder={() => undefined}
        onDeliverOrder={() => undefined}
        onPurchase={() => undefined}
        onSelectJob={() => undefined}
        selectedJobId={null}
        onSelectResource={() => undefined}
        selectedResourceId={null}
        onSetSpeed={() => undefined}
        onClockCommand={noop}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /驮运者一号 · 作业中/ }));
    expect(onSelectDevice).toHaveBeenCalledWith("device-1");
  });

  it("从地图选择建设位后进入详情，切换工作区再回来仍保留选择", () => {
    const snapshot = buildSnapshot({
      projects: [],
      sites: [{
        siteId: "site-a", name: "建设位 A", siteKey: "site_a",
        state: "free", note: null, description: null, attributes: []
      }],
      buildableProjects: [{
        definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
        name: "安装太阳电池阵", description: "增加发电能力", inputs: []
      }]
    });
    function ShellWithSelection() {
      const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
      return <BaseShell {...shellProps(snapshot)}
        selectedSiteId={selectedSiteId} onSelectSite={setSelectedSiteId} />;
    }
    render(<ShellWithSelection />);

    expect(screen.getByRole("heading", { name: /当前目标 · 安装太阳电池阵/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /建设位 A.*可开工工程/ }));
    expect(screen.getByRole("button", { name: "在这里建设" })).toBeTruthy();
    expect(document.activeElement?.contains(screen.getByLabelText("对象详情"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "经营" }));
    fireEvent.click(screen.getByRole("button", { name: "基地" }));
    expect(screen.getByRole("button", { name: "在这里建设" })).toBeTruthy();
  });

  it("经营输入在切换工作区后保留", () => {
    renderShell(buildSnapshot());
    fireEvent.click(screen.getByRole("button", { name: "经营" }));
    const quantity = screen.getByRole("spinbutton", { name: "购买数量·太阳电池阵组件" }) as HTMLInputElement;
    fireEvent.change(quantity, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "制造" }));
    fireEvent.click(screen.getByRole("button", { name: "经营" }));
    expect(screen.getByRole("spinbutton", { name: "购买数量·太阳电池阵组件" })).toHaveProperty("value", "3");
  });
});

describe("BaseShell > logout", () => {
  it("时间区提供退出登录按钮并上报", () => {
    const onLogout = vi.fn();
    render(
      <BaseShell
        snapshot={buildSnapshot()}
        csrfToken="csrf"
        selectedResourceId={null}
        selectedSiteId={null}
        selectedProjectId={null}
        selectedDeviceId={null}
        isBusy={false}
        onSelectSite={() => undefined}
        onSelectProject={() => undefined}
        onSelectDevice={() => undefined}
        onCreateProject={() => undefined}
        onCancelProject={() => undefined}
        onClockCommand={() => undefined}
        onSetSpeed={() => undefined}
        onCreateJob={() => undefined}
        onCancelJob={() => undefined}
        onAcceptOrder={() => undefined}
        onDeliverOrder={() => undefined}
        onPurchase={() => undefined}
        onSelectJob={() => undefined}
        selectedJobId={null}
        onSelectResource={() => undefined}
        onLogout={onLogout}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(onLogout).toHaveBeenCalledOnce();
  });
});
