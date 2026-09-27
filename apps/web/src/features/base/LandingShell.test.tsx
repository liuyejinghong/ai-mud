// R1 D 包：LandingShell 关键状态（02 §3/§5）：开局货单视图、缺料来源链、
// 目标派生的事实依据、采矿表单门控。数据用 fixture 快照（纯 UI 行为，标 MOCK）。
// design-review-20260927 B 线：D010/D011/D013/D014/D015/D017/D021/D023/D024/D025 行为锁定。
import { act, render, screen, fireEvent, cleanup, within } from "@testing-library/react";
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

  it("窄屏场景和操作可切换，目标与地图对象进入操作，库存可从操作入口独立打开", () => {
    const onSelect = vi.fn();
    render(<LandingShell {...props({ onSelect })} />);
    const scene = screen.getByRole("button", { name: "场景" });
    const operation = screen.getByRole("button", { name: "操作" });

    expect(scene.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "前往处理" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "site", siteId: "s-solar" });
    expect(operation.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(scene);
    fireEvent.click(screen.getByRole("button", { name: /北坡磁异常/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", nodeId: "n-1" });
    expect(operation.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(scene);
    fireEvent.click(operation);
    fireEvent.click(screen.getByRole("button", { name: /太阳能套件 可用 1/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "resource", itemId: "solar_kit" });
    expect(operation.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "返回地图" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "none" });
    expect(scene.getAttribute("aria-pressed")).toBe("true");
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
  it("unconfirmed ore points lead to surveying rather than claiming no source exists", () => {
    const steps=deriveSourceSteps("iron_ore",snapshot({resourceItemIds:["iron_ore","copper_ore"]}));
    expect(steps).toEqual([expect.objectContaining({kind:"node",targetNodeId:"n-1",label:"勘探北坡磁异常"})]);
    expect(steps.some(step=>step.label.includes("无获取方式"))).toBe(false);
  });

  it("opens the material source only for the chosen project card", () => {
    const base=snapshot();
    const expansion=base.buildableProjects[1]!;
    render(<LandingShell {...props({snapshot:snapshot({buildableProjects:[expansion,{...expansion,name:"增建储能",definitionRef:{kind:"project",stableId:"landing-expand-storage",revision:1}}]}),selection:{kind:"site",siteId:"s-solar"}})} />);
    fireEvent.click(screen.getAllByRole("button",{name:"准备材料"})[0]!);
    expect(screen.getAllByText(/获取路径/)).toHaveLength(1);
  });

});

// ---------- design-review-20260927 B 线修复（FIX-PLAN B 线任务） ----------
describe("LandingShell > design-review B 线", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("D010：冻结期顶栏如实显示『已暂停：等待前台接管』，机组/队列不再写作业中", () => {
    const snap = snapshot({
      timeMode: "running",
      speed: 2,
      // 冻结契约 2 字段（A 线下发；本地按契约 mock）：
      effectiveRunning: false,
      pauseReason: "foreground-required"
    } as Partial<BaseSnapshotDto>);
    snap.extractionJobs = [{
      jobId: "job-1", kind: "mine", status: "active", nodeId: "n-1", nodeName: "北坡磁异常",
      batchesPlanned: 1, batchesExtracted: 0, batchesDelivered: 0, phase: "mining",
      phaseWorkDone: 1, phaseWorkRequired: 2, builderOperatorIds: ["o-1"],
      haulerOperatorId: null, surveyorOperatorId: null, blockedReason: null
    }];
    snap.devices = [{
      deviceId: "d-1", operatorId: "o-1", name: "筑垒", groupId: "engineering", description: "",
      status: "working", batteryWh: 108, batteryCapacityWh: 180,
      currentAssignment: null, currentExtractionJobId: "job-1"
    }];
    render(<LandingShell {...props({ snapshot: snap, canControl: true })} />);
    expect(screen.getByText("已暂停：等待前台接管")).toBeTruthy();
    // 顶栏时钟区不再提供"暂停"（冻结期只能恢复/接管）；队列卡上的单任务"暂停"不受影响。
    const clockArea = screen.getByLabelText("基地时间");
    expect(within(clockArea).queryByRole("button", { name: "暂停" })).toBeNull();
    expect(within(clockArea).getByRole("button", { name: "恢复" })).toBeTruthy();
    expect((within(clockArea).getByRole("button", { name: "×2" }) as HTMLButtonElement).disabled).toBe(true);
    // 机组状态与队列卡不再矛盾：显示"已暂停"而非"作业 · 出工中"。
    expect(screen.getByText("筑垒 · 已暂停 · 108Wh")).toBeTruthy();
    expect(screen.getByText("已暂停")).toBeTruthy(); // 队列卡标记
  });

  it("D010：快照缺 effectiveRunning 字段时回退现有行为（running 显示暂停按钮）", () => {
    const snap = snapshot({ timeMode: "running", speed: 1 });
    render(<LandingShell {...props({ snapshot: snap, canControl: true })} />);
    expect(screen.queryByText(/等待前台接管/)).toBeNull();
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    const speed1 = screen.getByRole("button", { name: "×1" }) as HTMLButtonElement;
    expect(speed1.disabled).toBe(false);
    expect(speed1.getAttribute("aria-pressed")).toBe("true");
  });

  it("D010：接管失败显示可见原因，接管按钮保留可重试", () => {
    const snap = snapshot({ timeMode: "running", speed: 1 });
    render(<LandingShell {...props({ snapshot: snap, canControl: false, controlNotice: "已有其他前台会话" })} />);
    expect(screen.getByRole("alert").textContent).toContain("接管失败：已有其他前台会话");
    expect(screen.getByRole("button", { name: "接管" })).toBeTruthy();
  });

  it("D011：运行态时钟本地插值——×4 下每 15 秒走 1 基地分钟，不依赖快照到达", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T00:00:00.000Z"));
    const snap = snapshot({ timeMode: "running", speed: 4 });
    render(<LandingShell {...props({ snapshot: snap, canControl: true })} />);
    expect(screen.getByText("08:00 · 昼间")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText("08:01 · 昼间")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText("08:02 · 昼间")).toBeTruthy();
  });

  it("D011：暂停态时钟停针，不插值", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T00:00:00.000Z"));
    const snap = snapshot({ timeMode: "paused", speed: 4 });
    render(<LandingShell {...props({ snapshot: snap, canControl: true })} />);
    expect(screen.getByText("08:00 · 昼间")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText("08:00 · 昼间")).toBeTruthy();
  });

  it("D014：维护窗口前置就地可见——未建维护工位时按钮禁用并给出原因与下一步", () => {
    const snap = snapshot({
      productionSlots: [{
        slotId: "slot-1", siteId: "s-processing", siteName: "加工间", slotIndex: 0,
        batchesSinceMaintenance: 9, maintenanceBlocked: true, activeJobId: null
      }],
      resources: [{ itemId: "spare_part", name: "备件", quantity: 0, reservedQuantity: 0, reservationSources: [], description: "" }],
      capabilities: []
    });
    render(<LandingShell {...props({ snapshot: snap })} />);
    const maintain = screen.getAllByRole("button", { name: "维护（1 备件）" })[0] as HTMLButtonElement;
    expect(maintain.disabled).toBe(true);
    expect(screen.getByText(/需要先建成维护工位/)).toBeTruthy();
  });

  it("D014：有维护工位但缺备件时同样就地禁用＋缺口数值", () => {
    const snap = snapshot({
      productionSlots: [{
        slotId: "slot-1", siteId: "s-processing", siteName: "加工间", slotIndex: 0,
        batchesSinceMaintenance: 9, maintenanceBlocked: true, activeJobId: null
      }],
      resources: [{ itemId: "spare_part", name: "备件", quantity: 0, reservedQuantity: 0, reservationSources: [], description: "" }],
      capabilities: ["maintenance"]
    });
    render(<LandingShell {...props({ snapshot: snap })} />);
    const maintain = screen.getAllByRole("button", { name: "维护（1 备件）" })[0] as HTMLButtonElement;
    expect(maintain.disabled).toBe(true);
    expect(screen.getByText(/缺 1 备件（可用 0）/)).toBeTruthy();
  });

  it("D014：维护条件齐备时按钮可用", () => {
    const snap = snapshot({
      productionSlots: [{
        slotId: "slot-1", siteId: "s-processing", siteName: "加工间", slotIndex: 0,
        batchesSinceMaintenance: 9, maintenanceBlocked: true, activeJobId: null
      }],
      resources: [{ itemId: "spare_part", name: "备件", quantity: 2, reservedQuantity: 0, reservationSources: [], description: "" }],
      capabilities: ["maintenance"]
    });
    render(<LandingShell {...props({ snapshot: snap })} />);
    const maintain = screen.getAllByRole("button", { name: "维护（1 备件）" })[0] as HTMLButtonElement;
    expect(maintain.disabled).toBe(false);
  });

  it("D014：下采矿单条件不满足时现场给出原因（先选筑垒/驮运）", () => {
    const snap = snapshot({
      resourceNodes: [{
        nodeId: "n-1", nodeKey: "iron_north", name: "北坡磁异常", discovered: true,
        itemId: "iron_ore", itemName: "铁矿", remainingQuantity: 200, reservedQuantity: 0
      }],
      devices: [
        { deviceId: "d-1", operatorId: "o-1", name: "筑垒", groupId: "engineering", description: "", status: "idle", batteryWh: 108, batteryCapacityWh: 180, currentAssignment: null, currentExtractionJobId: null },
        { deviceId: "d-2", operatorId: "o-2", name: "驮运", groupId: "transport", description: "", status: "idle", batteryWh: 72, batteryCapacityWh: 120, currentAssignment: null, currentExtractionJobId: null }
      ]
    });
    render(<LandingShell {...props({ snapshot: snap, selection: { kind: "node", nodeId: "n-1" } })} />);
    expect((screen.getByText(/下采矿单/) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("先勾选 1–2 台空闲筑垒。")).toBeTruthy();
  });

  it("D015：配方行缺料就地显示可用/缺 N，准备材料展开获取路径（复用项目级组件）", () => {
    const snap = snapshot({
      sites: [
        { siteId: "s-lander", siteKey: "lander", name: "着陆器", state: "built", note: null, description: null, attributes: [] },
        { siteId: "s-processing", siteKey: "install_processing", name: "加工间", state: "built", note: "冶炼与材料制造", description: null, attributes: [] }
      ],
      productionSlots: [{
        slotId: "slot-1", siteId: "s-processing", siteName: "加工间", slotIndex: 0,
        batchesSinceMaintenance: 0, maintenanceBlocked: false, activeJobId: null
      }],
      resources: [{ itemId: "iron_ore", name: "铁矿", quantity: 0, reservedQuantity: 0, reservationSources: [], description: "" }],
      displayNames: { items: { iron_ingot: "铁料" }, facilities: {}, robots: {} }
    });
    render(<LandingShell {...props({ snapshot: snap, selection: { kind: "processing" } })} />);
    const smelt = screen.getByText("冶炼铁料").closest(".landing-build-option") as HTMLElement;
    expect(smelt.textContent).toContain("缺料");
    expect(smelt.textContent).toContain("铁矿 可用 0 · 缺 2");
    fireEvent.click(screen.getAllByRole("button", { name: "准备材料" })[0]!);
    expect(screen.getByText(/获取路径/)).toBeTruthy();
  });

  it("D015：仓库对已知名目显示可用 0，详情面板给获取路径", () => {
    const snap = snapshot({
      displayNames: { items: { iron_ingot: "铁料" }, facilities: {}, robots: {} }
    });
    render(<LandingShell {...props({ snapshot: snap })} />);
    expect(screen.getByText("铁料 可用 0")).toBeTruthy(); // 配方产出但库存为 0 的已知名目
    cleanup();
    render(<LandingShell {...props({ snapshot: snap, selection: { kind: "resource", itemId: "iron_ingot" } })} />);
    expect(screen.getByText(/可用 0（仓库当前没有库存）/)).toBeTruthy();
    expect(screen.getByText(/获取路径/)).toBeTruthy();
  });

  it("D015：地图上已建成的加工间直接提供『前往加工』入口", () => {
    const snap = snapshot({
      sites: [
        { siteId: "s-lander", siteKey: "lander", name: "着陆器", state: "built", note: "应急供电", description: null, attributes: [] },
        { siteId: "s-processing", siteKey: "install_processing", name: "加工间", state: "built", note: "冶炼与材料制造", description: null, attributes: [] }
      ]
    });
    const onSelect = vi.fn();
    render(<LandingShell {...props({ snapshot: snap, onSelect })} />);
    fireEvent.click(screen.getByRole("button", { name: "前往加工" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "processing" });
  });

  it("D017：『返回原工程』保留获取路径展开态", () => {
    const { rerender } = render(
      <LandingShell {...props({ selection: { kind: "site", siteId: "s-solar" } })} />
    );
    fireEvent.click(screen.getByRole("button", { name: "准备材料" }));
    expect(screen.getByText(/获取路径/)).toBeTruthy();
    // 经"前往加工"深链离开原工程（选择态受控，由测试模拟跳转结果）。
    fireEvent.click(screen.getAllByRole("button", { name: /前往加工/ })[0]!);
    rerender(<LandingShell {...props({ selection: { kind: "processing" } })} />);
    expect(screen.getByRole("button", { name: /返回原工程（太阳能安装位）/ })).toBeTruthy();
    // 返回原工程后获取路径仍展开，不需要再点一次"准备材料"。
    rerender(<LandingShell {...props({ selection: { kind: "site", siteId: "s-solar" } })} />);
    expect(screen.getByText(/获取路径/)).toBeTruthy();
  });

  it("D021：充电吞吐按实测口径显示（每机约 0.3 kW × 可充台数）", () => {
    render(<LandingShell {...props({ selection: { kind: "overview" } })} />);
    expect(screen.getByText(/每机约 0\.3 kW × 可充 1 台/)).toBeTruthy();
    expect(screen.getByText(/电路上限 0\.4 kW/)).toBeTruthy();
    expect(screen.queryByText(/^充电上限/)).toBeNull();
  });

  it("D023：预留/占用术语统一为『已占用』，并在仓库首现处给一句注释", () => {
    const snap = snapshot({
      resources: [{
        itemId: "solar_kit", name: "太阳能套件", quantity: 1, reservedQuantity: 1,
        reservationSources: [{ kind: "project", id: "p-1", name: "安装首座太阳能", quantity: 1 }],
        description: ""
      }]
    });
    render(<LandingShell {...props({ snapshot: snap })} />);
    expect(screen.getByText(/可用＝总量−已占用；已占用＝已为进行中的工程或工单预留。/)).toBeTruthy();
    expect(screen.getByText(/可用 0（总量 1，已占用 1）/)).toBeTruthy();
    cleanup();
    render(<LandingShell {...props({
      snapshot: snap, selection: { kind: "resource", itemId: "solar_kit" }
    })} />);
    expect(screen.getByText(/总量 1，已占用 1/)).toBeTruthy();
    expect(screen.getByText("预留 1")).toBeTruthy();
  });

  it("D024：仓储棚/维护工位安装面板补投产收益行", () => {
    const snap = snapshot({
      sites: [
        { siteId: "s-lander", siteKey: "lander", name: "着陆器", state: "built", note: "应急供电", description: null, attributes: [] },
        { siteId: "s-wh", siteKey: "install_warehouse", name: "仓储棚安装位", state: "free", note: null, description: null, attributes: [] },
        { siteId: "s-maint", siteKey: "install_maintenance", name: "维护工位安装位", state: "free", note: null, description: null, attributes: [] }
      ],
      buildableProjects: [
        {
          definitionRef: { kind: "project", stableId: "landing-install-warehouse", revision: 1 },
          name: "安装仓储棚", description: "", inputs: [{ itemId: "warehouse_kit", quantity: 1 }],
          allowedSiteKeys: ["install_warehouse"], canStart: true, blockers: [],
          outputFacility: { ref: { kind: "facility", stableId: "landing-warehouse", revision: 1 }, name: "仓储棚" }
        },
        {
          definitionRef: { kind: "project", stableId: "landing-install-maintenance", revision: 1 },
          name: "安装维护工位", description: "", inputs: [{ itemId: "maintenance_kit", quantity: 1 }],
          allowedSiteKeys: ["install_maintenance"], canStart: true, blockers: [],
          outputFacility: {
            ref: { kind: "facility", stableId: "landing-maintenance", revision: 1 }, name: "维护工位",
            effects: { capabilities: ["maintenance"] }
          }
        }
      ]
    });
    const { unmount } = render(<LandingShell {...props({ snapshot: snap, selection: { kind: "site", siteId: "s-wh" } })} />);
    expect(screen.getByText("投产收益：矿石入库与加工前置")).toBeTruthy();
    unmount();
    render(<LandingShell {...props({ snapshot: snap, selection: { kind: "site", siteId: "s-maint" } })} />);
    expect(screen.getByText("投产收益：解锁加工槽维护（每 10 批消耗 1 备件）")).toBeTruthy();
  });

  it("D025：运行中倍速档 aria-pressed 与选中一致", () => {
    const snap = snapshot({ timeMode: "running", speed: 4 });
    render(<LandingShell {...props({ snapshot: snap, canControl: true })} />);
    expect(screen.getByRole("button", { name: "×4" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "×1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("D013：未传 csrfToken 时事件面板不渲染（集成端点由 BaseApp 接线）", () => {
    render(<LandingShell {...props()} />);
    expect(screen.queryByText(/事件记录/)).toBeNull();
  });
});
