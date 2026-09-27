// R1 D 包：LandingShell 关键状态（02 §3/§5）：开局货单视图、缺料来源链、
// 目标派生的事实依据、采矿表单门控。数据用 fixture 快照（纯 UI 行为，标 MOCK）。
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import { deriveGoal, deriveSourceSteps, LandingShell, type LandingShellProps } from "./LandingShell.js";

function snapshot(overrides: Partial<BaseSnapshotDto> = {}): BaseSnapshotDto {
  return {
    name: "着陆场",
    baseId: "b-1",
    epoch: 1,
    baseRevision: 7,
    simTime: "2026-09-26T08:00:00.000Z",
    timeMode: "paused",
    speed: 1,
    activeContentRelease: "yudian-landing-1",
    power: {
      generationWPeak: 0,
      availableW: 0,
      storageWh: 1000,
      storageCapacityWh: 2000,
      loadW: 0,
      emergencyGenerationW: 1000,
      chargeLimitW: 400,
      powerPolicy: "production"
    },
    resources: [
      { itemId: "solar_kit", name: "太阳能套件", quantity: 1, reservedQuantity: 0, reservationSources: [], description: "" },
      { itemId: "iron_ore", name: "铁矿", quantity: 0, reservedQuantity: 0, reservationSources: [], description: "" },
      { itemId: "structural_frame", name: "结构件", quantity: 0, reservedQuantity: 0, reservationSources: [], description: "" }
    ],
    sites: [
      { siteId: "s-lander", siteKey: "lander", name: "着陆器", state: "built", note: "应急供电", description: null, attributes: [] },
      { siteId: "s-solar", siteKey: "install_solar", name: "太阳能安装位", state: "free", note: null, description: null, attributes: [] }
    ],
    devices: [
      {
        deviceId: "d-1", operatorId: "o-1", name: "筑垒", groupId: "engineering", description: "",
        status: "idle", batteryWh: 108, batteryCapacityWh: 180,
        currentAssignment: null, currentExtractionJobId: null
      }
    ],
    projects: [],
    buildableProjects: [
      {
        definitionRef: { kind: "project", stableId: "landing-install-solar", revision: 1 },
        name: "安装首座太阳能",
        description: "",
        inputs: [{ itemId: "solar_kit", quantity: 1 }],
        requiresFacilities: [],
        canStart: true,
        blockers: []
      },
      {
        definitionRef: { kind: "project", stableId: "landing-expand-solar", revision: 1 },
        name: "增建太阳能",
        description: "",
        inputs: [{ itemId: "structural_frame", quantity: 4 }],
        canStart: false,
        blockers: [{ type: "material", itemId: "structural_frame", required: 4, available: 0, inTransit: 0 }]
      }
    ],
    manufacturingJobs: [],
    availableRecipes: [
      {
        ref: { kind: "recipe", stableId: "landing-smelt-iron", revision: 1 },
        name: "冶炼铁料",
        description: "",
        inputs: [{ itemId: "iron_ore", quantity: 2 }],
        workPerUnit: 1,
        output: { kind: "item", itemId: "iron_ingot", quantity: 1 },
        ratedW: 2000,
        workMinutesPerBatch: 1,
        requiredCapability: "processing"
      },
      {
        ref: { kind: "recipe", stableId: "landing-make-structural", revision: 1 },
        name: "加工结构件",
        description: "",
        inputs: [{ itemId: "iron_ingot", quantity: 2 }],
        workPerUnit: 1,
        output: { kind: "item", itemId: "structural_frame", quantity: 1 },
        ratedW: 2000,
        workMinutesPerBatch: 1,
        requiredCapability: "processing"
      }
    ],
    cooperationRequests: [],
    credits: 0,
    orders: [],
    purchases: [],
    weather: {
      current: "clear", lightFactor: 1, dustLevel: 0,
      nextChangeAt: "2026-09-26T18:00:00.000Z", nextWeather: "clear"
    },
    controlLease: { heldByThisSession: true, controlActive: true, leaseUntil: "2026-09-26T08:06:00.000Z" },
    capabilities: [],
    resourceNodes: [
      {
        nodeId: "n-1", nodeKey: "iron_north", name: "北坡磁异常", discovered: false,
        itemId: null, itemName: null, remainingQuantity: null, reservedQuantity: null
      }
    ],
    extractionJobs: [],
    productionSlots: [],
    ...overrides
  } as BaseSnapshotDto;
}

function props(overrides: Partial<LandingShellProps> = {}): LandingShellProps {
  return {
    snapshot: snapshot(),
    isBusy: false,
    canControl: true,
    selection: { kind: "none" },
    onSelect: vi.fn(),
    onCreateProject: vi.fn(),
    onCancelProject: vi.fn(),
    onSurvey: vi.fn(),
    onCreateMining: vi.fn(),
    onExtractionAction: vi.fn(),
    onCreateJob: vi.fn(),
    onCancelJob: vi.fn(),
    onPauseJob: vi.fn(),
    onResumeJob: vi.fn(),
    onMaintain: vi.fn(),
    onPowerPolicy: vi.fn(),
    onClockCommand: vi.fn(),
    onAcquireControl: vi.fn(),
    onLogout: vi.fn(),
    accountEmail: "r1@q.test",
    feedback: null,
    ...overrides
  };
}

afterEach(cleanup);

describe("LandingShell", () => {
  it("开局：只看页面能说出运抵与未安装的东西（U01 可读性）", () => {
    render(<LandingShell {...props()} />);
    expect(screen.getByText("着陆器")).toBeTruthy();
    expect(screen.getByText("应急供电")).toBeTruthy(); // 已运行
    expect(screen.getByText("太阳能安装位")).toBeTruthy();
    expect(screen.getByText("空位")).toBeTruthy(); // 未安装
    expect(screen.getByText(/第 1 步 · 安装首座太阳能/)).toBeTruthy();
    expect(screen.getByText(/太阳能套件 可用 1/)).toBeTruthy();
  });

  it("缺料：扩建显示净缺口与结构化 blocker，主按钮禁用", () => {
    render(<LandingShell {...props({ selection: { kind: "site", siteId: "s-solar" } })} />);
    const expand = screen.getByRole("button", { name: "增建太阳能" });
    expect(expand).toBeTruthy();
    expect((expand as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/结构件 需要 4 · 可用 0/)).toBeTruthy();
    expect(screen.getByText("准备材料")).toBeTruthy(); // 净缺口给出来源入口
  });

  it("施工人数随项目卡选择提交，默认 2 台并可改为 1 台", () => {
    const onCreateProject = vi.fn();
    render(<LandingShell {...props({ onCreateProject, selection: { kind: "site", siteId: "s-solar" } })} />);
    const count = screen.getByLabelText("安装首座太阳能施工筑垒数量") as HTMLSelectElement;
    expect(count.value).toBe("2");
    fireEvent.change(count, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "安装首座太阳能" }));
    expect(onCreateProject).toHaveBeenLastCalledWith("landing-install-solar", "s-solar", 1);
    fireEvent.change(count, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "安装首座太阳能" }));
    expect(onCreateProject).toHaveBeenLastCalledWith("landing-install-solar", "s-solar", 2);
  });

  it("缺料用目录中文名展示，项目卡列出实际投产收益", () => {
    const base = snapshot();
    const noStockProject = {
      ...base.buildableProjects[1]!,
      name: "增建加工设施",
      inputs: [{ itemId: "iron_ingot", quantity: 8 }],
      requiresFacilities: ["solar_array"],
      blockers: [
        { type: "material" as const, itemId: "iron_ingot", required: 8, available: 0, inTransit: 0 },
        { type: "facility" as const, facilityId: "solar_array" }
      ],
      outputFacility: {
        ref: { kind: "facility" as const, stableId: "test_facility", revision: 1 },
        name: "测试设施",
        generationWPeak: 4000,
        effects: { storageCapacityWh: 5000, chargeLimitW: 1600, processingSlots: 1 }
      }
    };
    const snap = snapshot({
      displayNames: {
        items: { iron_ingot: "铁料" },
        facilities: { solar_array: "太阳能阵列" },
        robots: { "landing-hauler": "驮运机器人" }
      },
      buildableProjects: [noStockProject],
      availableRecipes: [
        ...base.availableRecipes,
        {
          ref: { kind: "recipe", stableId: "landing-build-hauler", revision: 1 },
          name: "组装驮运",
          description: "",
          inputs: [{ itemId: "structural_frame", quantity: 4 }],
          workPerUnit: 1,
          output: { kind: "robot", templateStableId: "landing-hauler", initialBatteryWh: 0 },
          ratedW: 2000,
          workMinutesPerBatch: 3,
          requiredCapability: "processing"
        }
      ]
    });
    const { rerender } = render(<LandingShell {...props({ snapshot: snap, selection: { kind: "site", siteId: "s-solar" } })} />);
    expect(screen.getByText(/铁料 需要 8 · 可用 0/)).toBeTruthy();
    expect(screen.getByText(/^设施前置：太阳能阵列$/)).toBeTruthy();
    expect(screen.getByText(/缺设施前置：太阳能阵列/)).toBeTruthy();
    expect(screen.getByText(/发电 \+4\.0 kW/)).toBeTruthy();
    expect(screen.getByText(/储能容量 \+5\.0 kWh（新增容量为空）/)).toBeTruthy();
    expect(screen.getByText(/充电上限 \+1\.6 kW/)).toBeTruthy();
    expect(screen.getByText(/加工槽 \+1/)).toBeTruthy();
    expect(screen.queryByText(/iron_ingot|solar_array/)).toBeNull();
    const processingSnap = snapshot({
      ...snap,
      sites: [...snap.sites, {
        siteId: "s-processing", siteKey: "install_processing", name: "加工间",
        state: "built", note: null, description: null, attributes: []
      }]
    });
    rerender(<LandingShell {...props({ snapshot: processingSnap, selection: { kind: "processing" } })} />);
    expect(screen.getByText(/铁矿×2 → 1 铁料×1/)).toBeTruthy();
    expect(screen.getByText(/1 台 驮运机器人×1/)).toBeTruthy();
  });

  it("来源链：结构件 → 加工结构件 → 冶炼铁料 → 铁矿采矿，逐层可达且可点回矿点", () => {
    const snap = snapshot({
      resourceNodes: [
        {
          nodeId: "n-1", nodeKey: "iron_north", name: "北坡磁异常", discovered: true,
          itemId: "iron_ore", itemName: "铁矿", remainingQuantity: 200, reservedQuantity: 0
        }
      ]
    });
    const steps = deriveSourceSteps("structural_frame", snap);
    expect(steps.map((step) => step.kind)).toEqual(["recipe", "recipe", "node"]);
    expect(steps[2]!.targetNodeId).toBe("n-1");
  });

  it("目标派生随事实推进：太阳能建成 → 下一步仓储棚", () => {
    const built = snapshot({
      sites: [
        { siteId: "s-lander", siteKey: "lander", name: "着陆器", state: "built", note: null, description: null, attributes: [] },
        { siteId: "s-solar", siteKey: "install_solar", name: "太阳能安装位", state: "built", note: "昼间供电", description: null, attributes: [] },
        { siteId: "s-wh", siteKey: "install_warehouse", name: "仓储棚安装位", state: "free", note: null, description: null, attributes: [] }
      ]
    });
    expect(deriveGoal(built).title).toBe("安装仓储棚");
    const explored = snapshot({
      resourceNodes: [
        { nodeId: "n-1", nodeKey: "iron_north", name: "北坡磁异常", discovered: true, itemId: "iron_ore", itemName: "铁矿", remainingQuantity: 200, reservedQuantity: 0 }
      ],
      sites: built.sites.map((site) =>
        site.siteKey === "install_warehouse" ? { ...site, state: "built" } : site
      )
    });
    expect(deriveGoal(explored).title).toBe("安排采矿运输");
  });

  it("矿点面板：未勘探时只给勘探入口；已勘探且选好设备才能下采矿单", () => {
    const onCreateMining = vi.fn();
    const { rerender } = render(
      <LandingShell {...props({ onCreateMining, selection: { kind: "node", nodeId: "n-1" } })} />
    );
    expect(screen.getByText(/北坡磁异常 · 勘探/)).toBeTruthy();
    expect(screen.queryByText(/下采矿单/)).toBeNull();

    const discovered = snapshot({
      resourceNodes: [
        { nodeId: "n-1", nodeKey: "iron_north", name: "北坡磁异常", discovered: true, itemId: "iron_ore", itemName: "铁矿", remainingQuantity: 200, reservedQuantity: 0 }
      ],
      devices: [
        { deviceId: "d-1", operatorId: "o-1", name: "筑垒", groupId: "engineering", description: "", status: "idle", batteryWh: 108, batteryCapacityWh: 180, currentAssignment: null, currentExtractionJobId: null },
        { deviceId: "d-2", operatorId: "o-2", name: "驮运", groupId: "transport", description: "", status: "idle", batteryWh: 72, batteryCapacityWh: 120, currentAssignment: null, currentExtractionJobId: null }
      ]
    });
    rerender(
      <LandingShell
        {...props({ onCreateMining, selection: { kind: "node", nodeId: "n-1" } })}
        snapshot={discovered}
      />
    );
    const submit = screen.getByText(/下采矿单/);
    expect((submit as HTMLButtonElement).disabled).toBe(true); // 未选设备
    fireEvent.click(screen.getByLabelText(/筑垒/));
    fireEvent.change(screen.getByLabelText(/驮运/), { target: { value: "o-2" } });
    const enabled = screen.getByText(/下采矿单/) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);
    expect(onCreateMining).toHaveBeenCalledWith({
      nodeId: "n-1",
      batches: 4,
      builderOperatorIds: ["o-1"],
      haulerOperatorId: "o-2"
    });
  });

  it("暂停采矿可取消勾选当前已被占用的原矿工，清空后禁用恢复", () => {
    const base = snapshot();
    const snap = snapshot({
      devices: [{
        ...base.devices[0]!,
        status: "working",
        currentAssignment: { projectId: "p-1", stepIndex: 0 }
      }],
      resourceNodes: [{
        nodeId: "n-1", nodeKey: "iron_north", name: "北坡磁异常", discovered: true,
        itemId: "iron_ore", itemName: "铁矿", remainingQuantity: 200, reservedQuantity: 4
      }],
      extractionJobs: [{
        jobId: "mine-1", kind: "mine", status: "paused", nodeId: "n-1", nodeName: "北坡磁异常",
        batchesPlanned: 1, batchesExtracted: 0, batchesDelivered: 0, phase: "mining",
        phaseWorkDone: 0, phaseWorkRequired: 2, builderOperatorIds: ["o-1"],
        haulerOperatorId: "o-2", surveyorOperatorId: null, blockedReason: "device_unavailable"
      }]
    });
    render(<LandingShell {...props({ snapshot: snap, selection: { kind: "node", nodeId: "n-1" } })} />);
    const originalBuilder = screen.getByRole("checkbox", { name: /筑垒.*占用/ }) as HTMLInputElement;
    expect(originalBuilder.disabled).toBe(false);
    expect(originalBuilder.checked).toBe(true);
    fireEvent.click(originalBuilder);
    expect(originalBuilder.checked).toBe(false);
    expect((screen.getByRole("button", { name: "换设备并恢复" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("切换矿点或同矿点的新作业时不沿用旧设备选择", () => {
    const base = snapshot();
    const twoNodes = snapshot({
      devices: [
        base.devices[0]!,
        { deviceId: "d-3", operatorId: "o-3", name: "筑垒", groupId: "engineering", description: "", status: "idle", batteryWh: 150, batteryCapacityWh: 180, currentAssignment: null, currentExtractionJobId: null },
        { deviceId: "d-2", operatorId: "o-2", name: "驮运", groupId: "transport", description: "", status: "idle", batteryWh: 72, batteryCapacityWh: 120, currentAssignment: null, currentExtractionJobId: null }
      ],
      resourceNodes: [
        { nodeId: "n-1", nodeKey: "iron_north", name: "北坡磁异常", discovered: true, itemId: "iron_ore", itemName: "铁矿", remainingQuantity: 200, reservedQuantity: 0 },
        { nodeId: "n-2", nodeKey: "copper_ridge", name: "脊线氧化带", discovered: true, itemId: "copper_ore", itemName: "铜矿", remainingQuantity: 200, reservedQuantity: 0 }
      ]
    });
    const { rerender } = render(
      <LandingShell {...props({ snapshot: twoNodes, selection: { kind: "node", nodeId: "n-1" } })} />
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /筑垒.*108Wh/ }));
    fireEvent.change(screen.getByLabelText("驮运"), { target: { value: "o-2" } });
    rerender(<LandingShell {...props({ snapshot: twoNodes, selection: { kind: "node", nodeId: "n-2" } })} />);
    expect((screen.getByRole("checkbox", { name: /筑垒.*108Wh/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("驮运") as HTMLSelectElement).value).toBe("");

    const pausedJob = (jobId: string, builderOperatorIds: string[]) => ({
      jobId, kind: "mine" as const, status: "paused" as const, nodeId: "n-2", nodeName: "脊线氧化带",
      batchesPlanned: 1, batchesExtracted: 0, batchesDelivered: 0, phase: "mining" as const,
      phaseWorkDone: 0, phaseWorkRequired: 2, builderOperatorIds, haulerOperatorId: "o-2",
      surveyorOperatorId: null, blockedReason: "device_unavailable"
    });
    rerender(
      <LandingShell {...props({
        snapshot: snapshot({ ...twoNodes, extractionJobs: [pausedJob("mine-1", ["o-1"])] }),
        selection: { kind: "node", nodeId: "n-2" }
      })} />
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /筑垒.*108Wh/ }));
    rerender(
      <LandingShell {...props({
        snapshot: snapshot({ ...twoNodes, extractionJobs: [pausedJob("mine-2", ["o-3"])] }),
        selection: { kind: "node", nodeId: "n-2" }
      })} />
    );
    const checkboxes = screen.getAllByRole("checkbox", { name: /筑垒/ }) as HTMLInputElement[];
    expect(checkboxes[0]!.checked).toBe(false);
    expect(checkboxes[1]!.checked).toBe(true);
  });
});
