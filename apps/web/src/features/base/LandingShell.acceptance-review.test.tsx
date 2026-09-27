// R1 D 包：LandingShell 关键状态（02 §3/§5）：开局货单视图、缺料来源链、
// 目标派生的事实依据、采矿表单门控。数据用 fixture 快照（纯 UI 行为，标 MOCK）。
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
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
function progressed(extra: Partial<BaseSnapshotDto> = {}): BaseSnapshotDto {
  return snapshot({
    sites: ["install_solar", "install_warehouse", "install_processing"].map((siteKey) => ({siteId:siteKey,siteKey,name:siteKey,state:"built",note:null,description:null,attributes:[]})),
    resourceNodes:[{nodeId:"n-1",nodeKey:"iron",name:"铁矿",discovered:true,itemId:"iron_ore",itemName:"铁矿",remainingQuantity:180,reservedQuantity:0}],
    ...extra
  });
}
describe("Independent R1 acceptance",()=>{
 it("spent ore and materials must not send completed expansion back to first mining tutorial",()=>{
  const s=progressed({projects:[{projectId:"done",definitionRef:{kind:"project",stableId:"landing-expand-solar",revision:1},status:"completed",steps:[]}] as unknown as BaseSnapshotDto["projects"]});
  expect(deriveGoal(s).stage).toBe(6);
 });
 it("one wire must not claim expansion materials are ready",()=>{
  const s=progressed({resources:[{itemId:"iron_ore",name:"铁矿",quantity:1,reservedQuantity:0,reservationSources:[],description:""},{itemId:"wire_cable",name:"线缆",quantity:1,reservedQuantity:0,reservationSources:[],description:""}]});
  expect(deriveGoal(s).reason).not.toContain("已就绪");
 });
 it("selecting two builders must still permit deselecting either",()=>{
  const proto=snapshot().devices[0]!;
  const s=progressed({devices:[{...proto,operatorId:"o-1",deviceId:"d1"},{...proto,operatorId:"o-2",deviceId:"d2"},{...proto,operatorId:"o-3",deviceId:"d3"}]});
  render(<LandingShell {...props({snapshot:s,selection:{kind:"node",nodeId:"n-1"}})} />);
  const boxes=screen.getAllByRole("checkbox") as HTMLInputElement[];
  fireEvent.click(boxes[0]!);fireEvent.click(boxes[1]!);
  expect(boxes[0]!.disabled).toBe(false);
 });
 it("depleted starting spares must expose the existing local spare recipe",()=>{
  const s=progressed();
  s.availableRecipes.push({ref:{kind:"recipe",stableId:"landing-make-spares",revision:1},name:"制造备件",description:"",inputs:[{itemId:"iron_ingot",quantity:1}],workPerUnit:1,output:{kind:"item",itemId:"spare_part",quantity:2},ratedW:2000,workMinutesPerBatch:1,requiredCapability:"processing"});
  expect(deriveSourceSteps("spare_part",s).some(x=>x.label.includes("制造备件"))).toBe(true);
 });
});
