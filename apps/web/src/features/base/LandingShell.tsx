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
  return benefits;
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
}

export function LandingShell(props: LandingShellProps) {
  const { snapshot } = props;
  const goal = useMemo(() => deriveGoal(snapshot), [snapshot]);
  // 缺料来源导航的返回上下文：从某工程进入来源链后，任意面板可一步回到原工程。
  const [sourceOriginSiteId, setSourceOriginSiteId] = useState<string | null>(null);
  const originSite = sourceOriginSiteId
    ? snapshot.sites.find((site) => site.siteId === sourceOriginSiteId) ?? null
    : null;
  const isPaused = snapshot.timeMode === "paused";
  const sites = snapshot.sites;
  const nodes = snapshot.resourceNodes ?? [];
  const extractionJobs = snapshot.extractionJobs ?? [];
  const slots = snapshot.productionSlots ?? [];

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
          <span>{formatSimClock(snapshot.simTime)}</span>
          {isPaused ? (
            <button type="button" className="landing-chip-button" disabled={props.isBusy || !props.canControl}
              onClick={() => props.onClockCommand("resume")}>恢复</button>
          ) : (
            <button type="button" className="landing-chip-button" disabled={props.isBusy || !props.canControl}
              onClick={() => props.onClockCommand("pause")}>暂停</button>
          )}
          {[1, 2, 4].map((speed) => (
            <button key={speed} type="button" className="landing-chip-button"
              aria-pressed={!isPaused && snapshot.speed === speed}
              disabled={props.isBusy || !props.canControl || isPaused}
              onClick={() => props.onClockCommand("set_speed", speed)}>×{speed}</button>
          ))}
          {!props.canControl ? (
            <button type="button" className="landing-chip-button" onClick={props.onAcquireControl}>接管</button>
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
              props.onSelect(
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

      <section className="landing-main">
        <div className="landing-map" aria-label="基地地图">
          <h2 className="landing-map-title">着陆场</h2>
          <div className="landing-map-grid">
            {sites.map((site) => (
              <SiteCard key={site.siteId} site={site} onSelect={props.onSelect} selected={props.selection} />
            ))}
          </div>
          <h2 className="landing-map-title">矿点</h2>
          <div className="landing-map-grid">
            {nodes.map((node) => (
              <NodeCard key={node.nodeId} node={node} snapshot={snapshot} onSelect={props.onSelect} selected={props.selection} />
            ))}
          </div>
          <div className="landing-fleet" aria-label="设备队">
            {snapshot.devices.map((device) => (
              <DeviceChip key={device.deviceId} device={device} onSelect={props.onSelect} selected={props.selection} />
            ))}
          </div>
        </div>
        <aside className="landing-panel" aria-label="对象操作">
          <button type="button" className="landing-back" onClick={() => { setSourceOriginSiteId(null); props.onSelect({ kind: "none" }); }}>
            返回地图
          </button>
          {originSite && !(props.selection.kind === "site" && props.selection.siteId === originSite.siteId) ? (
            <button
              type="button"
              className="landing-back"
              onClick={() => props.onSelect({ kind: "site", siteId: originSite.siteId })}
            >
              返回原工程（{originSite.name}）
            </button>
          ) : null}
          {props.feedback ? (
            <p className="landing-feedback" role="status">{props.feedback}</p>
          ) : null}
          <LandingPanel {...props} onOpenSource={setSourceOriginSiteId} />
        </aside>
      </section>

      <footer className="landing-queue" aria-label="进行中的工作">
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
            <button type="button" className="landing-chip-button" disabled={props.isBusy}
              onClick={() => props.onMaintain(slot.siteId)}>维护（1 备件）</button>
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
  onSelect
}: {
  site: BaseSiteDto;
  selected: LandingSelection;
  onSelect: (selection: LandingSelection) => void;
}) {
  const isSel = selected.kind === "site" && selected.siteId === site.siteId;
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
  onSelect
}: {
  device: BaseDeviceDto;
  selected: LandingSelection;
  onSelect: (selection: LandingSelection) => void;
}) {
  const isSel = selected.kind === "device" && selected.deviceId === device.deviceId;
  const busy = device.currentAssignment !== null || device.currentExtractionJobId != null;
  return (
    <button
      type="button"
      className={`landing-chip${isSel ? " is-selected" : ""}`}
      aria-pressed={isSel}
      onClick={() => onSelect({ kind: "device", deviceId: device.deviceId })}
    >
      {GROUP_LABELS[device.groupId] ?? device.groupId} · {STATUS_LABELS[device.status]}
      {busy ? " · 出工中" : ""} · {device.batteryWh}Wh
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

function LandingPanel(
  props: LandingShellProps & { onOpenSource?: ((siteId: string) => void) | undefined }
) {
  const { selection, snapshot } = props;
  switch (selection.kind) {
    case "site":
      return (
        <SitePanel
          {...props}
          site={snapshot.sites.find((site) => site.siteId === selection.siteId) ?? null}
          onOpenSource={props.onOpenSource}
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
      <ul className="landing-inventory">
        {snapshot.resources.map((resource) => (
          <li key={resource.itemId}>
            <button type="button" className="landing-chip" onClick={() => onSelect({ kind: "resource", itemId: resource.itemId })}>
              {itemName(snapshot, resource.itemId, resource.name)} 可用 {resource.quantity - resource.reservedQuantity}
              {resource.reservedQuantity > 0 ? `（总量 ${resource.quantity}，占用 ${resource.reservedQuantity}）` : ""}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SitePanel(
  props: LandingShellProps & { site: BaseSiteDto | null; onOpenSource?: ((siteId: string) => void) | undefined }
) {
  const { site, snapshot } = props;
  const [sourceFor, setSourceFor] = useState<string | null>(null);
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
                          setSourceFor(sourceFor === input.itemId ? null : input.itemId);
                          if (sourceFor !== input.itemId) props.onOpenSource?.(site.siteId);
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
            {sourceFor ? <SourceChain itemId={sourceFor} snapshot={snapshot} onSelect={props.onSelect} /> : null}
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
        disabled={props.isBusy || (builderIds ?? []).length === 0 || (builderIds ?? []).length > 2 || haulerId === "" || maxBatches < 1}
        onClick={() =>
          props.onCreateMining({
            nodeId: node.nodeId,
            batches,
            builderOperatorIds: builderIds ?? [],
            haulerOperatorId: haulerId
          })
        }
      >
        下采矿单（预留 {batches * 4} 矿）
      </button>
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
    return <div className="landing-panel-body"><p className="landing-dim">物资不存在。</p></div>;
  }
  return (
    <div className="landing-panel-body">
      <h3>{itemName(props.snapshot, resource.itemId, resource.name)}</h3>
      <p className="landing-dim">
        可用 {resource.quantity - resource.reservedQuantity}（总量 {resource.quantity}，工程占用 {resource.reservedQuantity}）
      </p>
      <p className="landing-copy">{resource.description}</p>
      {resource.reservedQuantity > 0 ? (
        <ul className="landing-attrs">
          {resource.reservationSources.map((source) => (
            <li key={source.id}><span className="landing-dim">{source.name}</span> 占用 {source.quantity}</li>
          ))}
        </ul>
      ) : null}
      <SourceChain itemId={resource.itemId} snapshot={props.snapshot} onSelect={props.onSelect} />
    </div>
  );
}

function ProcessingPanel(props: LandingShellProps) {
  const { snapshot } = props;
  const [batches, setBatches] = useState<Record<string, number>>({});
  const processingRecipes = snapshot.availableRecipes.filter(
    (recipe) => recipe.requiredCapability === "processing"
  );
  const manualRecipes = snapshot.availableRecipes.filter(
    (recipe) => recipe.requiredCapability === "lander_manual"
  );
  const slots = snapshot.productionSlots ?? [];
  const processingBuilt = slots.length > 0 || snapshot.sites.some((site) => site.siteKey === "install_processing" && site.state === "built");

  const renderRecipe = (recipe: RecipeTemplateDto) => {
    const count = batches[recipe.ref.stableId] ?? 1;
    const shortage = recipe.inputs.some((input) => {
      const resource = snapshot.resources.find((entry) => entry.itemId === input.itemId);
      return (resource?.quantity ?? 0) - (resource?.reservedQuantity ?? 0) < input.quantity * count;
    });
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
            <button type="button" className="landing-chip-button" disabled={props.isBusy}
              onClick={() => props.onMaintain(slot.siteId)}>
              维护（1 备件）
            </button>
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
          <p className="landing-dim">不需要加工间；加工槽全部停机且无备件时的公开恢复路径。</p>
          {manualRecipes.map(renderRecipe)}
        </>
      ) : null}
    </div>
  );
}

function OverviewPanel(props: LandingShellProps) {
  const { snapshot } = props;
  const power = snapshot.power;
  return (
    <div className="landing-panel-body">
      <h3>生产总览</h3>
      <ul className="landing-attrs">
        <li><span className="landing-dim">太阳能峰值</span> {kw(power.generationWPeak)} kW</li>
        <li><span className="landing-dim">应急电源</span> {kw(power.emergencyGenerationW ?? 0)} kW</li>
        <li><span className="landing-dim">储电</span> {kwh(power.storageWh)}/{kwh(power.storageCapacityWh)} kWh</li>
        <li><span className="landing-dim">充电上限</span> {kw(power.chargeLimitW ?? 0)} kW</li>
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

function formatSimClock(simTime: string): string {
  const date = new Date(simTime);
  if (Number.isNaN(date.getTime())) return simTime;
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const phase = date.getUTCHours() >= 6 && date.getUTCHours() < 18 ? "昼间" : "夜间";
  return `${hh}:${mm} · ${phase}`;
}
