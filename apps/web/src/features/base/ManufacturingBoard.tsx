// 制造面板（M13-D，玩家制造界面）：左侧可用配方（材料清单 + 数量 + 开工），右侧制造工单
// （状态 / 产出进度 / 当前台进度 / 阻塞原因 / 取消）。横向面板，接入 BaseShell 归 M13-I。
// 数据一律来自快照 props（manufacturingJobs / 当前配方模板列表），不在客户端推算工作量。
// 材料名暂以 itemId 显示：快照未带配方材料名，v0.13 物品名映射（catalog getItemInfo）另行接入。
import { useState } from "react";
import type {
  CreateManufacturingJobInputDto,
  ManufacturingJobDto,
  ManufacturingJobStatus,
  RecipeTemplateDto
} from "@ai-mud/shared";
import { MANUFACTURING_MAX_OUTPUTS } from "@ai-mud/shared";
import { describeBlockedReason } from "./ProjectBoard.js";

export const MANUFACTURING_JOB_STATUS_LABELS: Record<ManufacturingJobStatus, string> = {
  active: "进行中",
  paused: "已暂停",
  blocked: "已阻塞",
  completed: "已完成",
  cancelled: "已取消"
};

export interface ManufacturingBoardProps {
  jobs: ManufacturingJobDto[];
  recipes: RecipeTemplateDto[];
  isBusy: boolean;
  onCreateJob: (input: CreateManufacturingJobInputDto) => void;
  onCancelJob: (jobId: string) => void;
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
}

// outputsPlanned 合同范围 1..20；非法输入回退 1。
function clampOutputsPlanned(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MANUFACTURING_MAX_OUTPUTS, Math.max(1, Math.round(value)));
}

function cancelConfirmText(job: ManufacturingJobDto): string {
  return `确定取消工单「${job.recipeName}」吗？未消耗的材料会退还仓库，已消耗的部分不退还。`;
}

export function ManufacturingBoard({
  jobs,
  recipes,
  isBusy,
  onCreateJob,
  onCancelJob,
  selectedJobId,
  onSelectJob
}: ManufacturingBoardProps) {
  const [plannedByRecipe, setPlannedByRecipe] = useState<Record<string, number>>({});

  return (
    <section className="base-panel base-manufacturing" aria-label="制造">
      <h2 className="base-panel-title">制造</h2>
      <div
        className="base-manufacturing-columns"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
          gap: 10,
          alignItems: "start"
        }}
      >
        <div>
          <h3 className="base-kicker">可用配方</h3>
          {recipes.length === 0 ? (
            <p className="base-copy">当前内容目录没有可用配方。</p>
          ) : (
            <ul className="base-buildable-list">
              {recipes.map((recipe) => {
                const stableId = recipe.ref.stableId;
                const planned = clampOutputsPlanned(plannedByRecipe[stableId] ?? 1);
                return (
                  <li key={stableId}>
                    <span className="base-buildable-name">{recipe.name}</span>
                    <span className="base-copy">{recipe.description}</span>
                    <span className="base-project-step">
                      材料：
                      {recipe.inputs
                        .map((input) => `${input.itemId}×${input.quantity}`)
                        .join("、")}
                    </span>
                    <span className="base-project-step">每台工作量 {recipe.workPerUnit}</span>
                    <span
                      className="base-recipe-actions"
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <label className="base-field">
                        数量
                        <input
                          type="number"
                          min={1}
                          max={MANUFACTURING_MAX_OUTPUTS}
                          step={1}
                          value={planned}
                          disabled={isBusy}
                          aria-label={`${recipe.name}数量`}
                          onChange={(event) => {
                            const next = clampOutputsPlanned(Number(event.target.value));
                            setPlannedByRecipe((prev) => ({ ...prev, [stableId]: next }));
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="base-primary-button"
                        disabled={isBusy}
                        aria-label={`开工 ${recipe.name}`}
                        onClick={() =>
                          onCreateJob({
                            recipeRef: recipe.ref,
                            outputsPlanned: planned,
                            commandId: crypto.randomUUID()
                          })
                        }
                      >
                        开工
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h3 className="base-kicker">制造工单</h3>
          {jobs.length === 0 ? (
            <p className="base-copy">还没有制造工单。选一个配方开工。</p>
          ) : (
            <ul className="base-project-list">
              {jobs.map((job) => {
                // 在途工单持开工时修订（可旧于当前目录），按 stableId 关联当前模板取 workPerUnit。
                const recipe =
                  recipes.find(
                    (candidate) => candidate.ref.stableId === job.recipeRef.stableId
                  ) ?? null;
                const blockedLabel = describeBlockedReason(job.blockedReason);
                const unitPercent =
                  recipe !== null && recipe.workPerUnit > 0
                    ? Math.min(
                        100,
                        Math.round((job.currentUnitWorkDone / recipe.workPerUnit) * 100)
                      )
                    : null;
                return (
                  <li key={job.jobId} style={{ display: "grid", gap: 6 }}>
                    <button
                      type="button"
                      className={`base-project-card${selectedJobId === job.jobId ? " is-selected" : ""}`}
                      aria-pressed={selectedJobId === job.jobId}
                      onClick={() => onSelectJob(job.jobId)}
                    >
                      <span className="base-project-name">{job.recipeName}</span>
                      <span className="base-project-status">
                        {MANUFACTURING_JOB_STATUS_LABELS[job.status]}
                      </span>
                      <span className="base-project-step">
                        产出 {job.outputsDone}/{job.outputsPlanned} 台
                      </span>
                      {recipe !== null && unitPercent !== null ? (
                        <span className="base-progress">
                          <span
                            className="base-progress-bar"
                            role="progressbar"
                            aria-label={`${job.recipeName}当前台进度`}
                            aria-valuenow={job.currentUnitWorkDone}
                            aria-valuemin={0}
                            aria-valuemax={recipe.workPerUnit}
                            aria-valuetext={`${unitPercent}%`}
                          >
                            <span
                              className="base-progress-fill"
                              style={{ width: `${unitPercent}%` }}
                            />
                          </span>
                          <span className="base-progress-text">
                            {job.currentUnitWorkDone}/{recipe.workPerUnit}
                          </span>
                        </span>
                      ) : null}
                      {blockedLabel ? (
                        <span className="base-blocked-reason">已阻塞：{blockedLabel}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="base-danger-button"
                      disabled={isBusy}
                      aria-label={`取消工单 ${job.recipeName}`}
                      onClick={() => {
                        if (window.confirm(cancelConfirmText(job))) {
                          onCancelJob(job.jobId);
                        }
                      }}
                    >
                      取消
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
