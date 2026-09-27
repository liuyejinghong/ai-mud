// R1 landing 固定工作区（02-ui-contract.md）：顶栏 56 / 目标 64 / 主区（地图+右栏 360–420）/
// 队列 ~120 的 100dvh 网格；区域 minmax(0,1fr)+局部滚动。所有数字来自真实快照 DTO；
// 不用本地假计时/假库存。缺料来源由配方/节点关系逐层派生，可返回原对象。
import { useMemo, useState } from "react";
import type {
  BaseActionBlockerDto,
  BaseDeviceDto,
  BaseExtractionJobDto,
  BaseResourceDto,
  BaseResourceNodeDto,
  BaseSnapshotDto,
  BaseSiteDto,
  CreateExtractionJobInputDto,
  PowerPolicyPriority,
  RecipeTemplateDto
} from "@ai-mud/shared";
import { resolveRuntimeState } from "./runtimeState.js";
import { formatSimClock, useSimClock } from "./useSimClock.js";
import { EventsPanel } from "./EventsPanel.js";
import "./base.css";

const LANDING_RELEASE = "yudian-landing-1";

export function isLandingSnapshot(snapshot: BaseSnapshotDto): boolean {
  return snapshot.activeContentRelease === LANDING_RELEASE;
}

function kw(watts: number): string {
  return (watts / 1000).toFixed(1);
}
function kwh(value: number): string {
  return (value / 1000).toFixed(1);
}

function itemName(snapshot: BaseSnapshotDto, id: string, fallback?: string): string {
  return snapshot.displayNames?.items[id] ||
    snapshot.resources.find((resource) => resource.itemId === id)?.name ||
    fallback ||
    "未知物料";
}

function facilityName(snapshot: BaseSnapshotDto, id: string): string {
  return snapshot.displayNames?.facilities[id] ||
    snapshot.sites.find((site) => site.siteKey === id || site.siteId === id)?.name ||
    "未知设施";
}

function robotName(snapshot: BaseSnapshotDto, id: string): string {
  return snapshot.displayNames?.robots[id] || "未知设备";
}

// ---------- 缺料来源链：材料 → 产出它的配方/矿点，逐层可返回 ----------
interface SourceStep {
  kind: "node" | "recipe";
  label: string;
  detail: string;
  targetNodeId?: string;
  targetRecipeId?: string;
}

// 就地展开的获取路径（D017：跨面板往返后保留展开态，状态挂在 Shell 而不是面板）。
export interface SourceChainRef {
  // 定位展开位置：安装位 `${siteId}:${stableId}` 或加工行 `processing:${stableId}:${itemId}`。
  buildKey: string;
  itemId: string;
}

// 仓库已知名目：现有库存 ＋ 配方/工程引用到的物料（可用 0 也显示芯片，D015）。
export function knownItemIds(snapshot: BaseSnapshotDto): string[] {
  const ids = new Set<string>();
  for (const resource of snapshot.resources) ids.add(resource.itemId);
  for (const recipe of snapshot.availableRecipes) {
    for (const input of recipe.inputs) ids.add(input.itemId);
    if (recipe.output.kind === "item") ids.add(recipe.output.itemId);
  }
  for (const project of snapshot.buildableProjects) {
    for (const input of project.inputs ?? []) ids.add(input.itemId);
  }
  return [...ids];
}

export function deriveSourceSteps(
  itemId: string,
  snapshot: BaseSnapshotDto
): SourceStep[] {
  const steps: SourceStep[] = [];
  let current = itemId;
  for (let depth = 0; depth < 6; depth += 1) {
    const node = (snapshot.resourceNodes ?? []).find(
      (entry) => entry.discovered && entry.itemId === current
    );
    if (node) {
      steps.push({
        kind: "node",
        label: `${itemName(snapshot, current, node.itemName ?? undefined)} · 采矿运输`,
        detail: "派筑垒开采、驮运送回仓库",
        targetNodeId: node.nodeId
      });
      return steps;
    }
    if (snapshot.resourceItemIds?.includes(current)) {
      const unknown = (snapshot.resourceNodes ?? []).filter((entry) => !entry.discovered);
      if (unknown.length > 0) {
        steps.push(...unknown.map((entry): SourceStep => ({
          kind: "node",
          label: "勘探" + entry.name,
          detail: "确认是否存在" + itemName(snapshot, current) + "，勘探本身不产出物料",
          targetNodeId: entry.nodeId
        })));
        return steps;
      }
    }
    const recipe = snapshot.availableRecipes.find((entry) =>
      entry.output.kind === "item" ? entry.output.itemId === current : false
    );
    if (!recipe) break;
    steps.push({
      kind: "recipe",
      label: `${recipe.name}：${describeRecipeOutput(recipe, snapshot)}`,
      detail: recipe.inputs
        .map((input) => {
          const resource = snapshot.resources.find((entry) => entry.itemId === input.itemId);
          const available = (resource?.quantity ?? 0) - (resource?.reservedQuantity ?? 0);
          return `${itemName(snapshot, input.itemId)} ${available}/${input.quantity}`;
        })
        .join("、"),
      targetRecipeId: recipe.ref.stableId
    });
    const nextInput = recipe.inputs.find((input) => {
      const resource = snapshot.resources.find((entry) => entry.itemId === input.itemId);
      return (resource?.quantity ?? 0) - (resource?.reservedQuantity ?? 0) < input.quantity;
    });
    if (!nextInput) return steps;
    current = nextInput.itemId;
  }
  steps.push({ kind: "recipe", label: "当前版本无获取方式", detail: "" });
  return steps;
}

function describeRecipeOutput(recipe: RecipeTemplateDto, snapshot: BaseSnapshotDto): string {
  if (recipe.output.kind === "item") {
    return `${recipe.output.quantity} ${itemName(snapshot, recipe.output.itemId)}`;
  }
  return `1 台 ${robotName(snapshot, recipe.output.templateStableId)}`;
}

// D024：投产收益行——数值收益照实显示；仓储棚/维护工位这类"解锁类"设施补一行用途，
// 让六个安装面板的比较维度齐平（其余四个面板均有投产收益行）。
function describeProjectBenefits(
  output: BaseSnapshotDto["buildableProjects"][number]["outputFacility"]
): string[] {
  if (!output) return [];
  const benefits: string[] = [];
  if (output.generationWPeak !== undefined) benefits.push(`发电 +${kw(output.generationWPeak)} kW`);
  if (output.effects?.storageCapacityWh !== undefined) {
    benefits.push(`储能容量 +${kwh(output.effects.storageCapacityWh)} kWh（新增容量为空）`);
  }
  if (output.effects?.chargeLimitW !== undefined) benefits.push(`充电上限 +${kw(output.effects.chargeLimitW)} kW`);
  if (output.effects?.processingSlots !== undefined) benefits.push(`加工槽 +${output.effects.processingSlots}`);
  if (benefits.length === 0) {
    if (output.ref.stableId.includes("warehouse")) benefits.push("矿石入库与加工前置");
    if (output.effects?.capabilities?.includes("maintenance")) {
      benefits.push("解锁加工槽维护（每 10 批消耗 1 备件）");
    } else if (output.effects?.capabilities?.length) {
      benefits.push(`解锁能力：${output.effects.capabilities.join("、")}`);
    }
  }
  return benefits;
}

// 完工横幅用：说明"提升何物"（D024），模板不在目录里时返回 null 由调用方兜底。
export function projectBenefitSummary(snapshot: BaseSnapshotDto, stableId: string): string | null {
  const template = snapshot.buildableProjects.find(
    (project) => project.definitionRef.stableId === stableId
  );
  if (!template?.outputFacility) return null;
  const benefits = describeProjectBenefits(template.outputFacility);
  return benefits.length > 0 ? benefits.join("、") : null;
}

// D014：维护动作前置（服务端 REQUIREMENTS_NOT_MET 的两条件，就地预告而非事后报错）。
export function maintenanceReadiness(snapshot: BaseSnapshotDto): { ok: boolean; reason: string | null } {
  const spare = snapshot.resources.find((resource) => resource.itemId === "spare_part");
  const spareAvailable = (spare?.quantity ?? 0) - (spare?.reservedQuantity ?? 0);
  if (!(snapshot.capabilities ?? []).includes("maintenance")) {
    return { ok: false, reason: "需要先建成维护工位（先在维护工位安装位开工）" };
  }
  if (spareAvailable < 1) {
    return { ok: false, reason: `缺 1 备件（可用 ${Math.max(0, spareAvailable)}），先加工备件` };
  }
  return { ok: true, reason: null };
}

// ---------- 教程目标派生（01 §5：进度由服务端真实事实派生，非线性不判退步） ----------
interface GoalState {
  stage: number;
  title: string;
  reason: string;
  action: "site" | "node" | "processing" | "overview" | null;
  targetId?: string | undefined;
}

function facilityBuilt(snapshot: BaseSnapshotDto, siteKey: string): boolean {
  const site = snapshot.sites.find((entry) => entry.siteKey === siteKey);
  return site?.state === "built";
}

export function deriveGoal(snapshot: BaseSnapshotDto): GoalState {
  const solar = facilityBuilt(snapshot, "install_solar");
  const warehouse = facilityBuilt(snapshot, "install_warehouse");
  const processing = facilityBuilt(snapshot, "install_processing");
  const nodes = snapshot.resourceNodes ?? [];
  const discovered = nodes.filter((node) => node.discovered);
  // 历史事实（单调，不随库存消耗倒退）：已送矿的采矿单、已完成的加工单、已完成的扩建。
  const miningDone = (snapshot.extractionJobs ?? []).some((job) => job.batchesDelivered > 0);
  const expansionDone = snapshot.projects.some(
    (project) =>
      project.definitionRef.stableId.startsWith("landing-expand") && project.status === "completed"
  );
  const activeExpand = snapshot.projects.find(
    (project) =>
      project.definitionRef.stableId.startsWith("landing-expand") &&
      (project.status === "active" || project.status === "paused" || project.status === "blocked")
  );
  const available = (itemId: string) => {
    const resource = snapshot.resources.find((entry) => entry.itemId === itemId);
    return (resource?.quantity ?? 0) - (resource?.reservedQuantity ?? 0);
  };
  const name = (itemId: string) => itemName(snapshot, itemId);
  // 扩建就绪 = 某个具体扩建模板的全部输入都够（不是任一材料 >0）。
  const expansionTemplates = snapshot.buildableProjects.filter(
    (project) => project.definitionRef.stableId.startsWith("landing-expand")
  );
  const readyExpansion = expansionTemplates.find((project) =>
    (project.inputs ?? []).every((input) => available(input.itemId) >= input.quantity)
  );
  const bestGapExpansion = expansionTemplates[0];
  const gapSummary = bestGapExpansion
    ? (bestGapExpansion.inputs ?? [])
        .filter((input) => available(input.itemId) < input.quantity)
        .map((input) => `${name(input.itemId)} ${available(input.itemId)}/${input.quantity}`)
        .join("、")
    : "";
  const blockedSlot = (snapshot.productionSlots ?? []).find((slot) => slot.maintenanceBlocked);

  if (!solar) {
    return {
      stage: 1,
      title: "安装首座太阳能",
      reason: "着陆器只有 1 kW 应急供电；装上太阳能阵列后白天供电 +4 kW。",
      action: "site",
      targetId: snapshot.sites.find((site) => site.siteKey === "install_solar")?.siteId
    };
  }
  if (!warehouse) {
    return {
      stage: 2,
      title: "安装仓储棚",
      reason: "矿石要入仓、加工要有仓储棚做前置；顺路装好储能和充电区。",
      action: "site",
      targetId: snapshot.sites.find((site) => site.siteKey === "install_warehouse")?.siteId
    };
  }
  if (discovered.length === 0 && !miningDone && !expansionDone) {
    return {
      stage: 3,
      title: "勘探第一处矿点",
      reason: "北坡磁异常与脊线氧化带还没勘探，先派一台望山确认矿种。",
      action: "node",
      targetId: nodes[0]?.nodeId
    };
  }
  if (!miningDone && !expansionDone) {
    return {
      stage: 3,
      title: "安排采矿运输",
      reason: "矿点已确认，派筑垒开采、驮运送回仓库。",
      action: "node",
      targetId: discovered[0]?.nodeId
    };
  }
  if (!processing) {
    return {
      stage: 4,
      title: "安装加工间",
      reason: "矿石要冶炼成材料才能扩建；维护工位也一起装上。",
      action: "site",
      targetId: snapshot.sites.find((site) => site.siteKey === "install_processing")?.siteId
    };
  }
  if (activeExpand) {
    return {
      stage: 6,
      title: `${activeExpand.name}施工中`,
      reason: "自产部件正被工程消耗；完工后基地能力提升。",
      action: "site",
      targetId: activeExpand.siteId
    };
  }
  if (expansionDone) {
    // 首扩建已完成：进入再投资轮次；维护停机优先给恢复行动。
    if (blockedSlot) {
      return {
        stage: 5,
        title: "维护加工槽",
        reason: `加工槽已停机，消耗 1 备件维护后恢复生产（当前备件 ${available("spare_part")}）。`,
        action: "processing"
      };
    }
    if (readyExpansion) {
      return {
        stage: 6,
        title: `再投资：${readyExpansion.name}`,
        reason: `${readyExpansion.name}的全部材料已备齐，选一个空扩建位开工。`,
        action: "site",
        targetId: snapshot.sites.find((site) => site.siteKey.startsWith("expand_") && site.state === "free")?.siteId
      };
    }
    return {
      stage: 6,
      title: "继续下一轮生产",
      reason: gapSummary ? `还缺 ${gapSummary}；继续冶炼加工或维护备件。` : "补备件、开第二矿点，或继续加工材料。",
      action: "processing"
    };
  }
  // 首扩建前：维护停机优先给恢复行动，不被备料目标盖住。
  if (blockedSlot) {
    return {
      stage: 5,
      title: "维护加工槽",
      reason: `加工槽已停机，消耗 1 备件维护后恢复生产（当前备件 ${available("spare_part")}）。`,
      action: "processing"
    };
  }
  if (readyExpansion) {
    return {
      stage: 6,
      title: `用自产部件扩建：${readyExpansion.name}`,
      reason: `${readyExpansion.name}的全部材料已备齐，选一个空扩建位开工。`,
      action: "site",
      targetId: snapshot.sites.find((site) => site.siteKey.startsWith("expand_") && site.state === "free")?.siteId
    };
  }
  return {
    stage: 4,
    title: "冶炼与加工材料",
    reason: gapSummary
      ? `为${bestGapExpansion!.name}备料，还缺 ${gapSummary}。`
      : "冶炼铁料/铜料并加工结构件、线缆，为扩建备料。",
    action: "processing"
  };
}

// ---------- 属性与展示 ----------

const BLOCKER_LABELS: Record<BaseActionBlockerDto["type"], string> = {
  material: "缺料",
  facility: "缺设施前置",
  expansion_quota: "扩建位已满",
  device: "设备被占用",
  node: "矿点不可用",
  slot: "无可用加工槽",
  site: "无空闲建设位"
};

function describeBlockedReason(reason: string | null): string {
  switch (reason) {
    case "insufficient_power": return "供电不足";
    case "device_low_battery": return "设备电量不足（等待充电或换人）";
    case "device_unavailable": return "原设备暂不可用，等待其空闲后继续";
    case "maintenance_required": return "加工槽待维护";
    case "content_missing": return "内容缺失";
    default: return reason ?? "";
  }
}

export type LandingSelection =
  | { kind: "none" }
  | { kind: "site"; siteId: string }
  | { kind: "node"; nodeId: string }
  | { kind: "device"; deviceId: string }
  | { kind: "resource"; itemId: string }
  | { kind: "processing" }
  | { kind: "overview" };

export interface LandingShellProps {
  snapshot: BaseSnapshotDto;
  isBusy: boolean;
  canControl: boolean;
  selection: LandingSelection;
  onSelect: (selection: LandingSelection) => void;
  onCreateProject: (stableId: string, siteId: string, builderCount?: number) => void;
  onCancelProject: (projectId: string) => void;
  onSurvey: (nodeId: string, operatorId: string) => void;
  onCreateMining: (input: Omit<CreateExtractionJobInputDto, "commandId" | "expectedBaseRevision">) => void;
  onExtractionAction: (
    jobId: string,
    action: "pause" | "resume" | "cancel",
    payload?: { builderOperatorIds?: string[]; haulerOperatorId?: string }
  ) => void;
  onCreateJob: (recipe: RecipeTemplateDto, batches: number) => void;
  onCancelJob: (jobId: string) => void;
  onPauseJob: (jobId: string) => void;
  onResumeJob: (jobId: string) => void;
  onMaintain: (siteId: string) => void;
  onPowerPolicy: (priority: PowerPolicyPriority) => void;
  onClockCommand: (command: "pause" | "resume" | "set_speed", speed?: number) => void;
  onAcquireControl: () => void;
  onLogout: () => void;
  accountEmail: string | null;
  feedback: string | null;
  // D013 事件记录：会话 CSRF（null 时面板不挂载）；快照事实变化时刷新。
  csrfToken?: string | null;
  eventsRefreshKey?: number | string;
  // D010：接管失败的可见原因（null=无）；重试入口即顶栏"接管"按钮。
  controlNotice?: string | null;
}

// 充电吞吐的实测口径（D021/R03-F05：单机实测 ≈0.26–0.33 kW，总上限是电路能力不是实际吞吐）。
const PER_DEVICE_CHARGE_KW = 0.3;

export function LandingShell(props: LandingShellProps) {
  const { snapshot } = props;
  const goal = useMemo(() => deriveGoal(snapshot), [snapshot]);
  const runtime = resolveRuntimeState(snapshot);
  const frozen = runtime.frozenAwaitingForeground;
  const maintenance = maintenanceReadiness(snapshot);
  // D011-low：运行态时钟本地插值（按当前 speed 走字，快照到达即校准）。
  const clock = useSimClock(snapshot.simTime, snapshot.speed, runtime.effectivelyRunning);
  const [mobileView, setMobileView] = useState<"scene" | "operation">(
    props.selection.kind === "none" ? "scene" : "operation"
  );
  // 缺料来源导航的返回上下文：从某工程进入来源链后，任意面板可一步回到原工程。
  const [sourceOriginSiteId, setSourceOriginSiteId] = useState<string | null>(null);
  // D017：获取路径展开态挂在 Shell 层，"返回原工程"后不再收起。
  const [sourceChain, setSourceChain] = useState<SourceChainRef | null>(null);
  const selectForOperation = (selection: LandingSelection) => {
    setMobileView("operation");
    props.onSelect(selection);
  };
  const originSite = sourceOriginSiteId
    ? snapshot.sites.find((site) => site.siteId === sourceOriginSiteId) ?? null
    : null;
  const isPaused = runtime.timePaused;
  const sites = snapshot.sites;
  const nodes = snapshot.resourceNodes ?? [];
  const extractionJobs = snapshot.extractionJobs ?? [];
  const slots = snapshot.productionSlots ?? [];
  const chargeableDevices = snapshot.devices.filter(
    (device) => device.status === "idle" || device.status === "charging"
  ).length;

  return (
    <main className="landing-shell">
      <header className="landing-topbar">
        <h1 className="landing-base-name">{snapshot.name}</h1>
        <div className="landing-power-summary" aria-label="电力概览">
          <span>实际发电 {kw(snapshot.power.actualGenerationW ?? 0)} kW</span>
          <span className="landing-dim">
            太阳能 {kw(snapshot.power.actualSolarW ?? 0)} kW · 应急 {kw(snapshot.power.emergencyGenerationW ?? 0)} kW
          </span>
          <span className="landing-dim">峰值 {kw(snapshot.power.generationWPeak)} kW</span>
          <span>储电 {kwh(snapshot.power.storageWh)}/{kwh(snapshot.power.storageCapacityWh)} kWh</span>
          <span className="landing-dim">负载 {kw(snapshot.power.loadW)} kW</span>
        </div>
        <div className="landing-clock" aria-label="基地时间">
          {isPaused ? <span className="landing-dim">暂停 · </span> : null}
          {frozen ? (
            <strong className="landing-frozen-badge" role="status">已暂停：等待前台接管</strong>
          ) : null}
          <span>{formatSimClock(clock)}</span>
          {isPaused || (frozen && props.canControl) ? (
            <button type="button" className="landing-chip-button" disabled={props.isBusy || !props.canControl}
              onClick={() => props.onClockCommand("resume")}>恢复</button>
          ) : !frozen ? (
            <button type="button" className="landing-chip-button" disabled={props.isBusy || !props.canControl}
              onClick={() => props.onClockCommand("pause")}>暂停</button>
          ) : null}
          {[1, 2, 4].map((speed) => (
            <button key={speed} type="button" className="landing-chip-button"
              aria-pressed={runtime.effectivelyRunning && snapshot.speed === speed}
              disabled={props.isBusy || !props.canControl || !runtime.effectivelyRunning}
              onClick={() => props.onClockCommand("set_speed", speed)}>×{speed}</button>
          ))}
          {!props.canControl ? (
            <button type="button" className="landing-chip-button" onClick={props.onAcquireControl}>接管</button>
          ) : null}
          {props.controlNotice ? (
            <span className="landing-control-notice" role="alert" title={props.controlNotice}>
              接管失败：{props.controlNotice}；可再点一次「接管」重试。
            </span>
          ) : null}
        </div>
        <div className="landing-account">
          {props.accountEmail ? <span className="landing-dim">{props.accountEmail}</span> : null}
          <button type="button" className="landing-chip-button" onClick={props.onLogout}>退出</button>
        </div>
      </header>

      <section className="landing-goal" aria-label="当前目标">
        <div>
          <h2 className="landing-goal-title">第 {goal.stage} 步 · {goal.title}</h2>
          <p className="landing-goal-reason">{goal.reason}</p>
        </div>
        {goal.action ? (
          <button
            type="button"
            className="landing-primary"
            disabled={props.isBusy}
            onClick={() =>
              selectForOperation(
                goal.action === "site" && goal.targetId
                  ? { kind: "site", siteId: goal.targetId }
                  : goal.action === "node" && goal.targetId
                    ? { kind: "node", nodeId: goal.targetId }
                    : goal.action === "processing"
                      ? { kind: "processing" }
                      : { kind: "overview" }
              )
            }
          >
            前往处理
          </button>
        ) : null}
      </section>

      <div className="landing-view-switch" role="group" aria-label="基地视图">
        <button type="button" aria-pressed={mobileView === "scene"}
          onClick={() => setMobileView("scene")}>场景</button>
        <button type="button" aria-pressed={mobileView === "operation"}
          onClick={() => setMobileView("operation")}>操作</button>
      </div>

      <section className={`landing-main is-${mobileView}`}>
        <div className="landing-map" aria-label="基地地图">
          <h2 className="landing-map-title">着陆场</h2>
          <div className="landing-map-grid">
            {sites.map((site) => (
              <SiteCard
                key={site.siteId}
                site={site}
                goToProcessing={site.state === "built" && site.siteKey === "install_processing"}
                onSelect={selectForOperation}
                selected={props.selection}
              />
            ))}
          </div>
          <h2 className="landing-map-title">矿点</h2>
          <div className="landing-map-grid">
            {nodes.map((node) => (
              <NodeCard key={node.nodeId} node={node} snapshot={snapshot} onSelect={selectForOperation} selected={props.selection} />
            ))}
          </div>
          <div className="landing-fleet" aria-label="设备队">
            {snapshot.devices.map((device) => (
              <DeviceChip key={device.deviceId} device={device} frozen={frozen} onSelect={selectForOperation} selected={props.selection} />
            ))}
          </div>
        </div>
        <aside className="landing-panel has-overflow-affordance" aria-label="对象操作">
          <button type="button" className="landing-back" onClick={() => {
            setSourceOriginSiteId(null);
            setSourceChain(null);
            props.onSelect({ kind: "none" });
            setMobileView("scene");
          }}>
            返回地图
          </button>
          {originSite && !(props.selection.kind === "site" && props.selection.siteId === originSite.siteId) ? (
            <button
              type="button"
              className="landing-back"
              onClick={() => selectForOperation({ kind: "site", siteId: originSite.siteId })}
            >
              返回原工程（{originSite.name}）
            </button>
          ) : null}
          {props.feedback ? (
            <p className="landing-feedback" role="status">{props.feedback}</p>
          ) : null}
          <LandingPanel
            {...props}
            onSelect={selectForOperation}
            onOpenSource={setSourceOriginSiteId}
            sourceChain={sourceChain}
            onToggleSource={setSourceChain}
          />
          <EventsPanel csrfToken={props.csrfToken ?? null} refreshKey={props.eventsRefreshKey} />
        </aside>
      </section>

      <footer className="landing-queue" aria-label="进行中的工作">
        {frozen ? (
          <p className="landing-queue-paused-note" role="status">基地时间已暂停（等待前台接管），以下工作全部挂起。</p>
        ) : null}
        {snapshot.projects
          .filter((project) => project.status === "active" || project.status === "blocked" || project.status === "paused")
          .map((project) => {
            const currentStep = project.steps.find((step) => step.status !== "completed");
            return (
              <div key={project.projectId} className="landing-queue-card">
                <span className="landing-queue-title">{project.name}</span>
                <span className="landing-dim">
                  {currentStep
                    ? `${STEP_LABELS[currentStep.kind] ?? currentStep.kind} ${currentStep.workDone}/${currentStep.workRequired}`
                    : "收尾中"}
                  {currentStep?.blockedReason ? ` · ${describeBlockedReason(currentStep.blockedReason)}` : ""}
                </span>
                {frozen ? <span className="landing-queue-paused">已暂停</span> : null}
                <button type="button" className="landing-chip-button" disabled={props.isBusy}
                  onClick={() => props.onCancelProject(project.projectId)}>取消</button>
              </div>
            );
          })}
        {extractionJobs
          .filter((job) => job.status === "active" || job.status === "stopping" || job.status === "paused")
          .map((job) => (
            <div key={job.jobId} className="landing-queue-card">
              <span className="landing-queue-title">{job.kind === "survey" ? "勘探" : "采矿"} · {job.nodeName}</span>
              <span className="landing-dim">
                {job.kind === "mine"
                  ? `已送 ${job.batchesDelivered}/${job.batchesPlanned} 批`
                  : `勘察 ${job.phaseWorkDone}/2`}
                {job.blockedReason ? ` · ${describeBlockedReason(job.blockedReason)}` : ""}
              </span>
              {frozen ? <span className="landing-queue-paused">已暂停</span> : null}
              {job.status === "active" ? (
                <>
                  <button type="button" className="landing-chip-button" disabled={props.isBusy}
                    onClick={() => props.onExtractionAction(job.jobId, "pause")}>暂停</button>
                  <button type="button" className="landing-chip-button" disabled={props.isBusy}
                    onClick={() => props.onExtractionAction(job.jobId, "cancel")}>取消</button>
                </>
              ) : job.status === "paused" ? (
                <>
                  <button type="button" className="landing-chip-button" disabled={props.isBusy}
                    onClick={() => props.onExtractionAction(job.jobId, "resume")}>恢复</button>
                  <button type="button" className="landing-chip-button" disabled={props.isBusy}
                    onClick={() => props.onExtractionAction(job.jobId, "cancel")}>取消</button>
                </>
              ) : (
                <span className="landing-dim">送完即停</span>
              )}
            </div>
          ))}
        {snapshot.manufacturingJobs
          .filter((job) => job.status === "active" || job.status === "blocked" || job.status === "paused")
          .map((job) => (
            <div key={job.jobId} className="landing-queue-card">
              <span className="landing-queue-title">{job.recipeName}</span>
              <span className="landing-dim">
                {job.productionSiteId === null || job.productionSiteId === undefined ? "排队中 · " : ""}
                产出 {job.outputsDone}/{job.outputsPlanned}
                {job.blockedReason ? ` · ${describeBlockedReason(job.blockedReason)}` : ""}
              </span>
              {frozen ? <span className="landing-queue-paused">已暂停</span> : null}
              {job.status === "active" || job.status === "blocked" ? (
                <button type="button" className="landing-chip-button" disabled={props.isBusy}
                  onClick={() => props.onPauseJob(job.jobId)}>暂停</button>
              ) : (
                <button type="button" className="landing-chip-button" disabled={props.isBusy}
                  onClick={() => props.onResumeJob(job.jobId)}>恢复</button>
              )}
              <button type="button" className="landing-chip-button" disabled={props.isBusy}
                onClick={() => props.onCancelJob(job.jobId)}>取消</button>
            </div>
          ))}
        {slots.filter((slot) => slot.batchesSinceMaintenance >= 8).map((slot) => (
          <div key={slot.slotId} className="landing-queue-card">
            <span className="landing-queue-title">{slot.siteName} · 维护窗口</span>
            <span className="landing-dim">第 {slot.batchesSinceMaintenance}/10 批{slot.maintenanceBlocked ? "，已停机" : ""}</span>
            {frozen ? <span className="landing-queue-paused">已暂停</span> : null}
            <button type="button" className="landing-chip-button"
              disabled={props.isBusy || !maintenance.ok}
              onClick={() => props.onMaintain(slot.siteId)}>维护（1 备件）</button>
            {!maintenance.ok ? <span className="landing-hint is-short">{maintenance.reason}</span> : null}
          </div>
        ))}
        {queueEmpty(props.snapshot) ? (
          <p className="landing-dim">当前没有进行中的工程、采矿或加工。</p>
        ) : null}
      </footer>
    </main>
  );
}

function queueEmpty(snapshot: BaseSnapshotDto): boolean {
  const activeProjects = snapshot.projects.filter(
    (project) => project.status === "active" || project.status === "blocked" || project.status === "paused"
  ).length;
  const activeJobs = (snapshot.extractionJobs ?? []).filter(
    (job) => job.status === "active" || job.status === "stopping" || job.status === "paused"
  ).length;
  const activeManufacturing = snapshot.manufacturingJobs.filter(
    (job) => job.status === "active" || job.status === "blocked" || job.status === "paused"
  ).length;
  const needySlots = (snapshot.productionSlots ?? []).filter((slot) => slot.batchesSinceMaintenance >= 8).length;
  return activeProjects + activeJobs + activeManufacturing + needySlots === 0;
}

const STEP_LABELS: Record<string, string> = {
  site_clearing: "清场",
  transport: "运输",
  installation: "安装",
  commissioning: "验收"
};

const GROUP_LABELS: Record<string, string> = {
  transport: "驮运",
  engineering: "筑垒",
  survey: "望山"
};

function SiteCard({
  site,
  selected,
  onSelect,
  goToProcessing
}: {
  site: BaseSiteDto;
  selected: LandingSelection;
  onSelect: (selection: LandingSelection) => void;
  goToProcessing?: boolean;
}) {
  const isSel = selected.kind === "site" && selected.siteId === site.siteId;
  if (goToProcessing) {
    // D015：已建成的加工间在地图行直接给"前往加工"入口（不再只有设施信息面板）。
    return (
      <div className={`landing-card is-composite landing-site-built${isSel ? " is-selected" : ""}`}>
        <button
          type="button"
          className="landing-card-main"
          aria-pressed={isSel}
          onClick={() => onSelect({ kind: "site", siteId: site.siteId })}
        >
          <span className="landing-card-title">{site.name}</span>
          <span className="landing-dim">{site.note ?? "已运行"}</span>
        </button>
        <button
          type="button"
          className="landing-chip-button landing-card-goto"
          onClick={() => onSelect({ kind: "processing" })}
        >
          前往加工
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`landing-card landing-site-${site.state}${isSel ? " is-selected" : ""}`}
      aria-pressed={isSel}
      onClick={() => onSelect({ kind: "site", siteId: site.siteId })}
    >
      <span className="landing-card-title">{site.name}</span>
      <span className="landing-dim">
        {site.state === "built" ? (site.note ?? "已运行") : site.state === "reserved" ? "施工中" : "空位"}
      </span>
    </button>
  );
}

function NodeCard({
  node,
  snapshot,
  selected,
  onSelect
}: {
  node: BaseResourceNodeDto;
  snapshot: BaseSnapshotDto;
  selected: LandingSelection;
  onSelect: (selection: LandingSelection) => void;
}) {
  const isSel = selected.kind === "node" && selected.nodeId === node.nodeId;
  return (
    <button
      type="button"
      className={`landing-card landing-node${node.discovered ? "" : " is-undiscovered"}${isSel ? " is-selected" : ""}`}
      aria-pressed={isSel}
      onClick={() => onSelect({ kind: "node", nodeId: node.nodeId })}
    >
      <span className="landing-card-title">
        {node.discovered
          ? node.itemId ? itemName(snapshot, node.itemId, node.itemName ?? undefined) : "未知物料"
          : node.name}
      </span>
      <span className="landing-dim">
        {node.discovered
          ? `余 ${node.remainingQuantity}${node.reservedQuantity ? `（预留 ${node.reservedQuantity}）` : ""}`
          : "未勘探"}
      </span>
    </button>
  );
}

function DeviceChip({
  device,
  selected,
  onSelect,
  frozen
}: {
  device: BaseDeviceDto;
  selected: LandingSelection;
  onSelect: (selection: LandingSelection) => void;
  frozen?: boolean;
}) {
  const isSel = selected.kind === "device" && selected.deviceId === device.deviceId;
  const busy = device.currentAssignment !== null || device.currentExtractionJobId != null;
  // D010：基地冻结时不出工——机组状态如实显示"已暂停"，不再与"运行中"矛盾。
  const statusLabel = frozen && busy ? "已暂停" : STATUS_LABELS[device.status];
  return (
    <button
      type="button"
      className={`landing-chip${isSel ? " is-selected" : ""}`}
      aria-pressed={isSel}
      onClick={() => onSelect({ kind: "device", deviceId: device.deviceId })}
    >
      {GROUP_LABELS[device.groupId] ?? device.groupId} · {statusLabel}
      {busy && !frozen ? " · 出工中" : ""} · {device.batteryWh}Wh
    </button>
  );
}

const STATUS_LABELS: Record<string, string> = {
  idle: "待命",
  charging: "充电",
  working: "作业",
  offline: "离线"
};

// ---------- 右侧操作面板 ----------

interface PanelExtras {
  onOpenSource?: ((siteId: string) => void) | undefined;
  // D017：获取路径展开态由 Shell 持有，往返后保留。
  sourceChain?: SourceChainRef | null;
  onToggleSource?: ((next: SourceChainRef | null) => void) | undefined;
}

function LandingPanel(props: LandingShellProps & PanelExtras) {
  const { selection, snapshot } = props;
  switch (selection.kind) {
    case "site":
      return (
        <SitePanel
          {...props}
          site={snapshot.sites.find((site) => site.siteId === selection.siteId) ?? null}
          onOpenSource={props.onOpenSource}
          sourceChain={props.sourceChain ?? null}
          onToggleSource={props.onToggleSource}
        />
      );
    case "node": {
      const activeJob = (snapshot.extractionJobs ?? []).find(
        (job) => job.nodeId === selection.nodeId && job.status !== "completed" && job.status !== "cancelled"
      );
      return (
        <NodePanel
          key={`${selection.nodeId}:${activeJob?.jobId ?? "new"}`}
          {...props}
          node={(snapshot.resourceNodes ?? []).find((node) => node.nodeId === selection.nodeId) ?? null}
        />
      );
    }
    case "device":
      return <DevicePanel device={snapshot.devices.find((device) => device.deviceId === selection.deviceId) ?? null} />;
    case "resource":
      return <ResourcePanel {...props} itemId={selection.itemId} />;
    case "processing":
      return <ProcessingPanel {...props} />;
    case "overview":
      return <OverviewPanel {...props} />;
    default:
      return <NoSelectionPanel snapshot={snapshot} onSelect={props.onSelect} />;
  }
}

function NoSelectionPanel({ snapshot, onSelect }: { snapshot: BaseSnapshotDto; onSelect: (selection: LandingSelection) => void }) {
  return (
    <div className="landing-panel-body">
      <h3>选择一个对象</h3>
      <p className="landing-dim">点地图上的设施位、矿点或设备安排工作；从下方进入加工与总览。</p>
      <div className="landing-panel-actions">
        <button type="button" className="landing-secondary" onClick={() => onSelect({ kind: "processing" })}>
          加工间
        </button>
        <button type="button" className="landing-secondary" onClick={() => onSelect({ kind: "overview" })}>
          生产总览
        </button>
      </div>
      <h3>仓库</h3>
      {/* D023：术语首现注释——"已占用"与下单时的"预留"是同一件事。 */}
      <p className="landing-dim landing-hint">可用＝总量−已占用；已占用＝已为进行中的工程或工单预留。</p>
      <ul className="landing-inventory">
        {knownItemIds(snapshot).map((itemId) => {
          const resource = snapshot.resources.find((entry) => entry.itemId === itemId);
          const available = (resource?.quantity ?? 0) - (resource?.reservedQuantity ?? 0);
          return (
            <li key={itemId}>
              <button type="button" className="landing-chip" onClick={() => onSelect({ kind: "resource", itemId })}>
                {itemName(snapshot, itemId, resource?.name)} 可用 {available}
                {resource && resource.reservedQuantity > 0
                  ? `（总量 ${resource.quantity}，已占用 ${resource.reservedQuantity}）`
                  : ""}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SitePanel(props: LandingShellProps & PanelExtras & { site: BaseSiteDto | null }) {
  const { site, snapshot, sourceChain, onToggleSource } = props;
  const [builderCounts, setBuilderCounts] = useState<Record<string, 1 | 2>>({});
  if (!site) {
    return <div className="landing-panel-body"><p className="landing-dim">站点不存在。</p></div>;
  }
  const activeProject = snapshot.projects.find(
    (project) => project.siteId === site.siteId && project.status !== "completed" && project.status !== "cancelled"
  );
  if (activeProject) {
    const step = activeProject.steps.find((entry) => entry.status !== "completed");
    return (
      <div className="landing-panel-body">
        <h3>{activeProject.name}</h3>
        <p className="landing-dim">
          {step
            ? `${STEP_LABELS[step.kind] ?? step.kind} ${step.workDone}/${step.workRequired}${step.blockedReason ? ` · ${describeBlockedReason(step.blockedReason)}` : ""}`
            : "收尾中"}
        </p>
        <p className="landing-dim">完成后这里会显示新增的基地能力。</p>
      </div>
    );
  }
  if (site.state === "built") {
    return (
      <div className="landing-panel-body">
        <h3>{site.name}</h3>
        <p className="landing-dim">{site.note ?? "已运行"}</p>
        {site.description ? <p className="landing-copy">{site.description}</p> : null}
        <ul className="landing-attrs">
          {site.attributes.map((attribute) => (
            <li key={attribute.label}><span className="landing-dim">{attribute.label}</span> {attribute.value}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (site.state !== "free") {
    return <div className="landing-panel-body"><p className="landing-dim">该建设位已被占用。</p></div>;
  }
  const candidates = snapshot.buildableProjects.filter(
    (project) => !project.allowedSiteKeys || project.allowedSiteKeys.includes(site.siteKey)
  );
  if (candidates.length === 0) {
    return (
      <div className="landing-panel-body">
        <h3>{site.name}</h3>
        <p className="landing-dim">这个位置当前版本没有可建的工程（安装位与扩建位各司其职）。</p>
      </div>
    );
  }
  return (
    <div className="landing-panel-body">
      <h3>{site.name} · 开工</h3>
      {candidates.map((project) => {
        const blockers = project.blockers ?? [];
        const buildKey = `${site.siteId}:${project.definitionRef.stableId}`;
        const builderCount = builderCounts[buildKey] ?? 2;
        const benefits = describeProjectBenefits(project.outputFacility);
        return (
          <div key={project.definitionRef.stableId} className="landing-build-option">
            <label className="landing-field">
              施工筑垒数量
              <select
                aria-label={`${project.name}施工筑垒数量`}
                value={builderCount}
                onChange={(event) => setBuilderCounts((current) => ({
                  ...current,
                  [buildKey]: Number(event.target.value) as 1 | 2
                }))}
              >
                <option value={1}>1 台</option>
                <option value={2}>2 台</option>
              </select>
            </label>
            <button
              type="button"
              className="landing-primary"
              disabled={props.isBusy || !(project.canStart ?? true)}
              onClick={() => props.onCreateProject(project.definitionRef.stableId, site.siteId, builderCount)}
            >
              {project.name}
            </button>
            {benefits.length > 0 ? (
              <p className="landing-dim">投产收益：{benefits.join(" · ")}</p>
            ) : null}
            <ul className="landing-build-details">
              {project.requiresFacilities?.length ? (
                <li>设施前置：{project.requiresFacilities.map((id) => facilityName(snapshot, id)).join("、")}</li>
              ) : null}
              {(project.inputs ?? []).map((input) => {
                const resource = snapshot.resources.find((entry) => entry.itemId === input.itemId);
                const available = (resource?.quantity ?? 0) - (resource?.reservedQuantity ?? 0);
                const short = available < input.quantity;
                return (
                  <li key={input.itemId} className={short ? "is-short" : undefined}>
                    <span>{itemName(snapshot, input.itemId)} 需要 {input.quantity} · 可用 {Math.max(0, available)}</span>
                    {short ? (
                      <button
                        type="button"
                        className="landing-chip-button"
                        onClick={() => {
                          const close = sourceChain?.buildKey === buildKey && sourceChain.itemId === input.itemId;
                          onToggleSource?.(close ? null : { buildKey, itemId: input.itemId });
                          if (!close) props.onOpenSource?.(site.siteId);
                        }}
                      >
                        准备材料
                      </button>
                    ) : null}
                  </li>
                );
              })}
              {blockers
                .filter((blocker) => blocker.type !== "material")
                .map((blocker, index) => (
                  <li key={index} className="is-short">{BLOCKER_LABELS[blocker.type]}{blocker.facilityId ? `：${facilityName(snapshot, blocker.facilityId)}` : ""}</li>
                ))}
            </ul>
            {sourceChain?.buildKey === buildKey ? (
              <SourceChain itemId={sourceChain.itemId} snapshot={snapshot} onSelect={props.onSelect} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SourceChain({
  itemId,
  snapshot,
  onSelect
}: {
  itemId: string;
  snapshot: BaseSnapshotDto;
  onSelect: (selection: LandingSelection) => void;
}) {
  const steps = deriveSourceSteps(itemId, snapshot);
  const noSource = steps.length === 1 && steps[0]!.label === "当前版本无获取方式";
  return (
    <div className="landing-source-chain" aria-label={`${itemName(snapshot, itemId)} 的获取来源`}>
      <p className="landing-dim">获取路径（可进入对应生产，返回原工程不丢上下文）：</p>
      <ol>
        {steps.map((step, index) => (
          <li key={index}>
            {step.kind === "node" && step.targetNodeId ? (
              <button type="button" className="landing-chip-button"
                onClick={() => onSelect({ kind: "node", nodeId: step.targetNodeId! })}>
                {step.label} · 前往采矿
              </button>
            ) : step.targetRecipeId ? (
              <button type="button" className="landing-chip-button"
                onClick={() => onSelect({ kind: "processing" })}>
                {step.label} · 前往加工
              </button>
            ) : (
              <span>{step.label}</span>
            )}
            {step.detail ? <span className="landing-dim">（{step.detail}）</span> : null}
          </li>
        ))}
      </ol>
      {noSource ? (
        <p className="landing-dim">该物资为随船有限件或当前版本无生产路径。</p>
      ) : null}
    </div>
  );
}

function NodePanel(props: LandingShellProps & { node: BaseResourceNodeDto | null }) {
  const { node, snapshot } = props;
  const surveyors = snapshot.devices.filter((device) => device.groupId === "survey");
  const builders = snapshot.devices.filter((device) => device.groupId === "engineering");
  const haulers = snapshot.devices.filter((device) => device.groupId === "transport");
  const [surveyorId, setSurveyorId] = useState<string>("");
  const [builderIds, setBuilderIds] = useState<string[] | null>(null);
  const [haulerId, setHaulerId] = useState<string>("");
  const [batches, setBatches] = useState(4);

  if (!node) {
    return <div className="landing-panel-body"><p className="landing-dim">矿点不存在。</p></div>;
  }
  const deviceBusy = (device: BaseDeviceDto) =>
    device.currentAssignment !== null || device.currentExtractionJobId != null;

  if (!node.discovered) {
    const activeSurvey = (snapshot.extractionJobs ?? []).find(
      (job) => job.kind === "survey" && job.nodeId === node.nodeId && job.status !== "completed" && job.status !== "cancelled"
    );
    return (
      <div className="landing-panel-body">
        <h3>{node.name} · 勘探</h3>
        {activeSurvey ? (
          <p className="landing-dim">勘探进行中：勘察 {activeSurvey.phaseWorkDone}/2，完成后揭示矿种与储量。</p>
        ) : (
          <>
            <p className="landing-dim">派一台望山完成勘探（约 2 个基地分钟），只揭示、不发物资。</p>
            <label className="landing-field">
              望山
              <select value={surveyorId} onChange={(event) => setSurveyorId(event.target.value)}>
                <option value="">选择设备…</option>
                {surveyors.map((device) => (
                  <option key={device.operatorId} value={device.operatorId} disabled={deviceBusy(device)}>
                    望山 · {STATUS_LABELS[device.status]} · {device.batteryWh}Wh{deviceBusy(device) ? "（占用）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="landing-primary" disabled={props.isBusy || surveyorId === ""}
              onClick={() => props.onSurvey(node.nodeId, surveyorId)}>
              开始勘探
            </button>
            {surveyorId === "" && !props.isBusy ? (
              <p className="landing-hint is-short" role="status">先在上方选一台空闲望山。</p>
            ) : null}
          </>
        )}
      </div>
    );
  }

  const activeMine = (snapshot.extractionJobs ?? []).find(
    (job) => job.kind === "mine" && job.nodeId === node.nodeId && job.status !== "completed" && job.status !== "cancelled"
  );
  if (activeMine) {
    if (activeMine.status === "paused") {
      // 恢复时重验设备：默认沿用原设备，玩家可换被占用/低电的设备。
      const resumeBuilders = builderIds ?? activeMine.builderOperatorIds;
      const resumeHauler = haulerId || activeMine.haulerOperatorId || "";
      return (
        <div className="landing-panel-body">
          <h3>{node.itemId ? itemName(snapshot, node.itemId, node.itemName ?? undefined) : "未知物料"} · 恢复采矿</h3>
          <p className="landing-dim">
            已送 {activeMine.batchesDelivered}/{activeMine.batchesPlanned} 批；工序进度与矿量预留保留。
            选择设备后恢复（原设备被占用或低电时可换人）。
          </p>
          <div className="landing-field">
            筑垒（1–2 台）
            {builders.map((device) => (
              <label key={device.operatorId} className="landing-check">
                <input
                  type="checkbox"
                  checked={resumeBuilders.includes(device.operatorId)}
                  disabled={(deviceBusy(device) && !resumeBuilders.includes(device.operatorId)) || (resumeBuilders.length >= 2 && !resumeBuilders.includes(device.operatorId))}
                  onChange={(event) =>
                    setBuilderIds(event.target.checked
                      ? [...resumeBuilders, device.operatorId]
                      : resumeBuilders.filter((id) => id !== device.operatorId))
                  }
                />
                筑垒 · {STATUS_LABELS[device.status]} · {device.batteryWh}Wh{deviceBusy(device) ? "（占用）" : ""}
              </label>
            ))}
          </div>
          <label className="landing-field">
            驮运
            <select value={resumeHauler} onChange={(event) => setHaulerId(event.target.value)}>
              <option value="">选择设备…</option>
              {haulers.map((device) => (
                <option key={device.operatorId} value={device.operatorId} disabled={deviceBusy(device)}>
                  驮运 · {STATUS_LABELS[device.status]} · {device.batteryWh}Wh{deviceBusy(device) ? "（占用）" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="landing-primary"
            disabled={props.isBusy || resumeBuilders.length === 0 || resumeBuilders.length > 2 || resumeHauler === ""}
            onClick={() =>
              props.onExtractionAction(activeMine.jobId, "resume", {
                builderOperatorIds: resumeBuilders,
                haulerOperatorId: resumeHauler
              })
            }
          >
            换设备并恢复
          </button>
        </div>
      );
    }
    return (
      <div className="landing-panel-body">
        <h3>{node.itemId ? itemName(snapshot, node.itemId, node.itemName ?? undefined) : "未知物料"} · 采矿中</h3>
        <p className="landing-dim">
          已送 {activeMine.batchesDelivered}/{activeMine.batchesPlanned} 批（每批 4 矿）。
          {activeMine.blockedReason ? `受阻：${describeBlockedReason(activeMine.blockedReason)}` : ""}
        </p>
      </div>
    );
  }
  const maxBatches = Math.min(10, Math.floor((node.remainingQuantity ?? 0) / 4));
  // D014：下单按钮就地禁用时要给出现场原因与下一步（不再让玩家猜为什么点不动）。
  const selectedBuilders = builderIds ?? [];
  const miningSubmitReason =
    maxBatches < 1
      ? "矿点余量不足一批（每批 4 矿）。"
      : builders.length === 0
        ? "还没有可出工的筑垒。"
        : selectedBuilders.length === 0
          ? "先勾选 1–2 台空闲筑垒。"
          : haulerId === ""
            ? "再选 1 台驮运负责运回。"
            : null;
  const miningSubmitDisabled =
    props.isBusy || selectedBuilders.length === 0 || selectedBuilders.length > 2 || haulerId === "" || maxBatches < 1;
  return (
    <div className="landing-panel-body">
      <h3>{node.itemId ? itemName(snapshot, node.itemId, node.itemName ?? undefined) : "未知物料"} · 采矿运输</h3>
      <p className="landing-dim">余 {node.remainingQuantity}，每批 4 矿：开采 2 筑垒点＋运输 1 驮运点，送达才入仓。</p>
      <label className="landing-field">
        批数（1–{maxBatches}）
        <input type="number" min={1} max={maxBatches} value={batches}
          onChange={(event) => setBatches(Math.max(1, Math.min(maxBatches, Number(event.target.value) || 1)))} />
      </label>
      <div className="landing-field">
        筑垒（选 1–2 台）
        {builders.map((device) => (
          <label key={device.operatorId} className="landing-check">
            <input
              type="checkbox"
              checked={(builderIds ?? []).includes(device.operatorId)}
              disabled={deviceBusy(device) || ((builderIds ?? []).length >= 2 && !(builderIds ?? []).includes(device.operatorId))}
              onChange={(event) =>
                setBuilderIds(event.target.checked
                  ? [...(builderIds ?? []), device.operatorId]
                  : (builderIds ?? []).filter((id) => id !== device.operatorId))
              }
            />
            筑垒 · {STATUS_LABELS[device.status]} · {device.batteryWh}Wh{deviceBusy(device) ? "（占用）" : ""}
          </label>
        ))}
      </div>
      <label className="landing-field">
        驮运
        <select value={haulerId} onChange={(event) => setHaulerId(event.target.value)}>
          <option value="">选择设备…</option>
          {haulers.map((device) => (
            <option key={device.operatorId} value={device.operatorId} disabled={deviceBusy(device)}>
              驮运 · {STATUS_LABELS[device.status]} · {device.batteryWh}Wh{deviceBusy(device) ? "（占用）" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="landing-primary"
        disabled={miningSubmitDisabled}
        onClick={() =>
          props.onCreateMining({
            nodeId: node.nodeId,
            batches,
            builderOperatorIds: builderIds ?? [],
            haulerOperatorId: haulerId
          })
        }
      >
        下采矿单（为本工程预留 {batches * 4} 矿）
      </button>
      {!miningSubmitDisabled || miningSubmitReason === null ? null : (
        <p className="landing-hint is-short" role="status">{miningSubmitReason}</p>
      )}
    </div>
  );
}

function DevicePanel({ device }: { device: BaseDeviceDto | null }) {
  if (!device) {
    return <div className="landing-panel-body"><p className="landing-dim">设备不存在。</p></div>;
  }
  const busy = device.currentAssignment !== null || device.currentExtractionJobId != null;
  return (
    <div className="landing-panel-body">
      <h3>{GROUP_LABELS[device.groupId] ?? device.groupId} · {STATUS_LABELS[device.status]}</h3>
      <p className="landing-dim">
        电量 {device.batteryWh}/{device.batteryCapacityWh} Wh
        {busy ? " · 正在出工（不能同时充电）" : ""}
      </p>
      <p className="landing-copy">{device.description}</p>
    </div>
  );
}

function ResourcePanel(props: LandingShellProps & { itemId: string }) {
  const resource = props.snapshot.resources.find((entry) => entry.itemId === props.itemId);
  if (!resource) {
    // D015：可用 0 的已知名目（配方/工程引用但仓库没有）也能打开详情并看到获取路径。
    return (
      <div className="landing-panel-body">
        <h3>{itemName(props.snapshot, props.itemId)}</h3>
        <p className="landing-dim">可用 0（仓库当前没有库存）。</p>
        <SourceChain itemId={props.itemId} snapshot={props.snapshot} onSelect={props.onSelect} />
      </div>
    );
  }
  return (
    <div className="landing-panel-body">
      <h3>{itemName(props.snapshot, resource.itemId, resource.name)}</h3>
      <p className="landing-dim">
        可用 {resource.quantity - resource.reservedQuantity}（总量 {resource.quantity}，已占用 {resource.reservedQuantity}）
      </p>
      <p className="landing-copy">{resource.description}</p>
      {resource.reservedQuantity > 0 ? (
        <ul className="landing-attrs">
          {resource.reservationSources.map((source) => (
            <li key={source.id}><span className="landing-dim">{source.name}</span> 预留 {source.quantity}</li>
          ))}
        </ul>
      ) : null}
      <SourceChain itemId={resource.itemId} snapshot={props.snapshot} onSelect={props.onSelect} />
    </div>
  );
}

function ProcessingPanel(props: LandingShellProps & PanelExtras) {
  const { snapshot, sourceChain, onToggleSource } = props;
  const [batches, setBatches] = useState<Record<string, number>>({});
  const processingRecipes = snapshot.availableRecipes.filter(
    (recipe) => recipe.requiredCapability === "processing"
  );
  const manualRecipes = snapshot.availableRecipes.filter(
    (recipe) => recipe.requiredCapability === "lander_manual"
  );
  const slots = snapshot.productionSlots ?? [];
  const processingBuilt = slots.length > 0 || snapshot.sites.some((site) => site.siteKey === "install_processing" && site.state === "built");
  const maintenance = maintenanceReadiness(snapshot);

  const renderRecipe = (recipe: RecipeTemplateDto) => {
    const count = batches[recipe.ref.stableId] ?? 1;
    // D015：配方级缺料就地给出"可用 N · 缺 M ＋来源链接"，与项目级"准备材料"同一套组件。
    const inputs = recipe.inputs.map((input) => {
      const resource = snapshot.resources.find((entry) => entry.itemId === input.itemId);
      const available = Math.max(0, (resource?.quantity ?? 0) - (resource?.reservedQuantity ?? 0));
      const need = input.quantity * count;
      return { itemId: input.itemId, available, need, short: available < need };
    });
    const shortage = inputs.some((input) => input.short);
    const missing = inputs.filter((input) => input.short);
    const sourceKeyFor = (itemId: string) => `processing:${recipe.ref.stableId}:${itemId}`;
    return (
      <div key={recipe.ref.stableId} className="landing-build-option">
        <div className="landing-recipe-head">
          <span className="landing-card-title">{recipe.name}</span>
          <span className="landing-dim">
            {recipe.inputs.map((input) => {
              return `${itemName(snapshot, input.itemId)}×${input.quantity * count}`;
            }).join("、")} → {describeRecipeOutput(recipe, snapshot)}×{count}
            {recipe.ratedW ? ` · 约 ${kw(recipe.ratedW)} kW` : ""}
          </span>
        </div>
        <div className="landing-panel-actions">
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            aria-label={`${recipe.name} 批数`}
            onChange={(event) =>
              setBatches({
                ...batches,
                [recipe.ref.stableId]: Math.max(1, Math.min(20, Number(event.target.value) || 1))
              })
            }
          />
          <button
            type="button"
            className="landing-primary"
            disabled={props.isBusy || shortage}
            onClick={() => props.onCreateJob(recipe, count)}
          >
            {shortage ? "缺料" : "下单"}
          </button>
        </div>
        {shortage ? (
          <div className="landing-recipe-shortage">
            {missing.map((input) => {
              const key = sourceKeyFor(input.itemId);
              const open = sourceChain?.buildKey === key;
              return (
                <div key={input.itemId} className="landing-recipe-missing">
                  <span className="is-short">
                    {itemName(snapshot, input.itemId)} 可用 {input.available} · 缺 {input.need - input.available}
                  </span>
                  <button
                    type="button"
                    className="landing-chip-button"
                    aria-expanded={open}
                    onClick={() => onToggleSource?.(open ? null : { buildKey: key, itemId: input.itemId })}
                  >
                    准备材料
                  </button>
                </div>
              );
            })}
            {missing.some((input) => sourceChain?.buildKey === sourceKeyFor(input.itemId)) ? (
              <SourceChain
                itemId={sourceChain!.itemId}
                snapshot={snapshot}
                onSelect={props.onSelect}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="landing-panel-body">
      <h3>加工间</h3>
      {slots.map((slot) => (
        <p key={slot.slotId} className="landing-dim">
          {slot.siteName} 槽：第 {slot.batchesSinceMaintenance}/10 批
          {slot.maintenanceBlocked ? " · 待维护停机" : ""}
          {slot.batchesSinceMaintenance >= 8 && !slot.maintenanceBlocked ? " · 可维护" : ""}
          {(slot.batchesSinceMaintenance >= 8 || slot.maintenanceBlocked) ? (
            <button type="button" className="landing-chip-button"
              disabled={props.isBusy || !maintenance.ok}
              aria-disabled={!maintenance.ok}
              title={!maintenance.ok ? maintenance.reason ?? undefined : undefined}
              onClick={() => props.onMaintain(slot.siteId)}>
              维护（1 备件）
            </button>
          ) : null}
          {(slot.batchesSinceMaintenance >= 8 || slot.maintenanceBlocked) && !maintenance.ok ? (
            <span className="landing-hint is-short">{maintenance.reason}</span>
          ) : null}
        </p>
      ))}
      {!processingBuilt && slots.length === 0 ? (
        <p className="landing-dim">还没有建成加工间；先安装加工套件。</p>
      ) : null}
      {processingBuilt ? processingRecipes.map(renderRecipe) : null}
      {manualRecipes.length > 0 ? (
        <>
          <h3>着陆器手工恢复</h3>
          <p className="landing-dim">不需要加工间；加工槽全部停机且无备件时的恢复路径。</p>
          {manualRecipes.map(renderRecipe)}
        </>
      ) : null}
    </div>
  );
}

function OverviewPanel(props: LandingShellProps) {
  const { snapshot } = props;
  const power = snapshot.power;
  // D021：充电吞吐按实测口径显示（每机约 0.3 kW × 可充台数），不再只标总上限造成高估。
  const chargeable = snapshot.devices.filter(
    (device) => device.status === "idle" || device.status === "charging"
  ).length;
  return (
    <div className="landing-panel-body">
      <h3>生产总览</h3>
      <ul className="landing-attrs">
        <li><span className="landing-dim">太阳能峰值</span> {kw(power.generationWPeak)} kW</li>
        <li><span className="landing-dim">应急电源</span> {kw(power.emergencyGenerationW ?? 0)} kW</li>
        <li><span className="landing-dim">储电</span> {kwh(power.storageWh)}/{kwh(power.storageCapacityWh)} kWh</li>
        <li>
          <span className="landing-dim">充电吞吐</span> 每机约 {PER_DEVICE_CHARGE_KW} kW × 可充 {chargeable} 台
          （电路上限 {kw(power.chargeLimitW ?? 0)} kW）
        </li>
      </ul>
      <div className="landing-panel-actions">
        <span className="landing-dim">优先级</span>
        <button
          type="button"
          className="landing-chip-button"
          aria-pressed={(power.powerPolicy ?? "production") === "production"}
          disabled={props.isBusy}
          onClick={() => props.onPowerPolicy("production")}
        >
          加工优先
        </button>
        <button
          type="button"
          className="landing-chip-button"
          aria-pressed={power.powerPolicy === "charging"}
          disabled={props.isBusy}
          onClick={() => props.onPowerPolicy("charging")}
        >
          充电优先
        </button>
      </div>
      <p className="landing-dim">
        新档没有外部补给渠道：经营体现在采矿、加工、维护与扩建的资源分配。
      </p>
    </div>
  );
}
