import type { CurrentActionDto, StartGatheringRequestDto } from "@ai-mud/shared";
import type { PrimaryAction } from "../controller/gameSelectors";
import { clampProgressPct } from "./panelFormatters";

type PrimaryActionId = PrimaryAction["id"];

export interface ActionPanelProps {
  actions: readonly PrimaryAction[];
  currentAction: CurrentActionDto | null;
  plannedMinutes: StartGatheringRequestDto["plannedMinutes"];
  onPlannedMinutesChange: (minutes: StartGatheringRequestDto["plannedMinutes"]) => void;
  onAction: (actionId: PrimaryActionId) => void | Promise<void>;
  onOpenDialogue?: () => void | Promise<void>;
  onOpenCombat?: () => void;
  disabled?: boolean;
}

const gatheringActionIds = new Set<PrimaryActionId>(["gather", "start_gathering"]);

function isPrimaryButton(actionId: PrimaryActionId) {
  return (
    actionId === "claim_relief" ||
    actionId === "enter_corrupt_forest" ||
    gatheringActionIds.has(actionId)
  );
}

export function ActionPanel({
  actions,
  currentAction,
  plannedMinutes,
  onPlannedMinutesChange,
  onAction,
  onOpenDialogue,
  onOpenCombat,
  disabled = false
}: ActionPanelProps) {
  const canCancelAction = actions.some((action) => action.id === "cancel_action");
  const displayedActions = actions.filter(
    (action) =>
      action.id !== "cancel_action" &&
      action.id !== "move" &&
      action.id !== "view_npc_tasks" &&
      action.id !== "repair_equipment" &&
      action.id !== "eat_food" &&
      action.id !== "create_character"
  );

  return (
    <>
      <section className="quick-action-panel" aria-label="常用动作">
        <div className="panel-heading">
          <h2>动作</h2>
          <span>{displayedActions.length} 项可执行</span>
        </div>
        <div className="game-actions">
          {displayedActions.map((action) =>
            gatheringActionIds.has(action.id) ? (
              <div className="duration-select" key={action.id}>
                <select
                  aria-label="采集时长"
                  value={plannedMinutes}
                  disabled={disabled}
                  onChange={(event) =>
                    onPlannedMinutesChange(
                      Number(event.target.value) as StartGatheringRequestDto["plannedMinutes"]
                    )
                  }
                >
                  <option value={10}>10 分钟</option>
                  <option value={30}>30 分钟</option>
                  <option value={120}>2 小时</option>
                </select>
                <button
                  type="button"
                  className="game-primary-button"
                  disabled={disabled}
                  onClick={() => void onAction(action.id)}
                >
                  {action.label}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={isPrimaryButton(action.id) ? "game-primary-button" : "game-secondary-button"}
                disabled={disabled}
                key={action.id}
                onClick={() => void onAction(action.id)}
              >
                {action.label}
              </button>
            )
          )}
          {onOpenDialogue ? (
            <button
              type="button"
              className="game-secondary-button"
              disabled={disabled}
              onClick={() => void onOpenDialogue()}
            >
              附近 NPC
            </button>
          ) : null}
        </div>
      </section>

      {currentAction ? (
        <section className="active-action-panel" aria-labelledby="active-action-title">
          <div className="panel-heading">
            <h2 id="active-action-title">当前行动</h2>
            <span>总进度 {currentAction.progressPct}%</span>
          </div>
          <p>{currentAction.description}</p>
          <div
            className="action-progress"
            role="progressbar"
            aria-label="行动进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clampProgressPct(currentAction.progressPct)}
          >
            <span style={{ width: `${clampProgressPct(currentAction.progressPct)}%` }} />
          </div>
          {currentAction.actionType === "gathering" && currentAction.cycleProgressPct !== null ? (
            <p className="action-meta">
              本轮采集 {currentAction.cycleProgressPct}%
              {currentAction.settledCycles !== null && currentAction.plannedCycles !== null
                ? ` · 已入账 ${currentAction.settledCycles}/${currentAction.plannedCycles}`
                : ""}
            </p>
          ) : null}
          {currentAction.expectedYield.length > 0 ? (
            <p className="action-meta">
              计划总产出：
              {currentAction.expectedYield
                .map((item) => `${item.name} x${item.quantity}`)
                .join("，")}
            </p>
          ) : null}
          <div className="game-actions">
            {currentAction.actionType === "combat" && onOpenCombat ? (
              <button
                type="button"
                className="game-secondary-button"
                disabled={disabled}
                onClick={onOpenCombat}
              >
                查看战斗
              </button>
            ) : null}
            {canCancelAction ? (
              <button
                type="button"
                className="game-secondary-button"
                disabled={disabled}
                onClick={() => void onAction("cancel_action")}
              >
                {currentAction.actionType === "combat" ? "撤离" : "取消行动"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
