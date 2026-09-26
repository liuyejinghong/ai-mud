// 底部项目清单：显示快照中的项目进度与正在作业的设备。
import type {
  BaseDeviceDto,
  BaseProjectDto,
  BaseProjectStepDto,
  BaseTimeMode,
  ProjectStatus,
  StepKind,
  StepStatus
} from "@ai-mud/shared";
import { BASE_ROBOT_GROUP_NAMES } from "@ai-mud/shared";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "准备中",
  active: "进行中",
  paused: "已暂停",
  blocked: "受阻",
  completed: "已完成",
  cancelled: "已取消",
  failed: "已失败"
};

export const STEP_KIND_LABELS: Record<StepKind, string> = {
  site_clearing: "场地清理",
  transport: "物资运输",
  installation: "设备安装",
  commissioning: "调试验收"
};

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: "等待中",
  ready: "待开工",
  running: "施工中",
  blocked: "受阻",
  completed: "已完成",
  failed: "已失败"
};

const BLOCKED_REASON_LABELS: Record<string, string> = {
  insufficient_power: "供电不足"
};

export function describeBlockedReason(reason: string | null): string | null {
  if (reason === null) return null;
  return BLOCKED_REASON_LABELS[reason] ?? reason;
}

export function workingCrew(projectId: string, stepIndex: number, devices: BaseDeviceDto[]): number {
  return devices.filter((device) =>
    device.status === "working" && device.currentAssignment?.projectId === projectId &&
    device.currentAssignment.stepIndex === stepIndex
  ).length;
}

export function describeIdleStep(
  project: BaseProjectDto,
  step: BaseProjectStepDto,
  devices: BaseDeviceDto[],
  timeMode: BaseTimeMode
): string | null {
  if (["completed", "cancelled", "failed"].includes(project.status) ||
    workingCrew(project.projectId, step.index, devices) > 0) return null;
  if (timeMode === "paused" || project.status === "paused") return "当前 0 台作业中：基地时间已暂停。";
  if (step.blockedReason) return `当前 0 台作业中：${describeBlockedReason(step.blockedReason)}。`;
  const group = devices.filter((device) => device.groupId === step.groupId);
  if (group.length === 0) return `当前 0 台作业中：没有${BASE_ROBOT_GROUP_NAMES[step.groupId]}设备。`;
  if (group.every((device) => device.batteryWh < 500)) return "当前 0 台作业中：本组设备电量低，需等待补电。";
  if (group.every((device) => device.status === "charging")) return "当前 0 台作业中：本组设备正在充电。";
  return "当前 0 台作业中，等待基地调度。";
}

export interface ProjectBoardProps {
  projects: BaseProjectDto[];
  buildableProjects: Array<{ name: string; description: string }>;
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  devices: BaseDeviceDto[];
  timeMode: BaseTimeMode;
}

export function ProjectBoard({
  projects,
  buildableProjects,
  selectedProjectId,
  onSelectProject,
  devices,
  timeMode
}: ProjectBoardProps) {
  return (
    <section className="base-panel base-board" aria-label="项目清单">
      <h2 className="base-panel-title">项目清单</h2>
      {projects.length === 0 ? (
        <div className="base-goal-card">
          <strong className="base-goal-title">当前目标</strong>
          {buildableProjects.length > 0 && buildableProjects[0] ? (
            <>
              <p className="base-copy">
                {buildableProjects[0].name} —— {buildableProjects[0].description}
              </p>
              <p className="base-copy">点击地图上虚线框的「建设位 A」，点「在这里建设」开工。</p>
            </>
          ) : (
            <p className="base-copy">
              首批工程已完成。更多工程类型将随基地发展解锁（内容工坊在后续版本开放）。
            </p>
          )}
        </div>
      ) : (
        <ul className="base-project-list">
          {projects.map((project) => {
            const currentIndex = project.steps.findIndex((step) => step.status !== "completed");
            const currentStep =
              currentIndex >= 0
                ? project.steps[currentIndex]
                : (project.steps[project.steps.length - 1] ?? null);
            const blockedLabel = currentStep
              ? describeBlockedReason(currentStep.blockedReason)
              : null;
            const progressPercent =
              currentStep && currentStep.workRequired > 0
                ? Math.min(
                    100,
                    Math.round((currentStep.workDone / currentStep.workRequired) * 100)
                  )
                : null;
            const crew = currentStep ? workingCrew(project.projectId, currentStep.index, devices) : 0;
            const idleNote = currentStep ? describeIdleStep(project, currentStep, devices, timeMode) : null;

            return (
              <li key={project.projectId}>
                <button
                  type="button"
                  className={`base-project-card${selectedProjectId === project.projectId ? " is-selected" : ""}`}
                  aria-pressed={selectedProjectId === project.projectId}
                  onClick={() => onSelectProject(project.projectId)}
                >
                  <span className="base-project-name">{project.name}</span>
                  <span className="base-project-status">
                    {PROJECT_STATUS_LABELS[project.status]}
                  </span>
                  {currentStep ? (
                    <span className="base-project-step">
                      当前步骤 {currentIndex >= 0 ? currentIndex + 1 : project.steps.length}/
                      {project.steps.length}：{STEP_KIND_LABELS[currentStep.kind]}（
                      {STEP_STATUS_LABELS[currentStep.status]}）
                      {currentStep.status === "running" && crew > 0 ? ` · 机组 ${crew} 台作业中` : ""}
                    </span>
                  ) : (
                    <span className="base-project-step">该项目没有施工步骤</span>
                  )}
                  {currentStep && progressPercent !== null ? (
                    <span className="base-progress">
                      <span
                        className="base-progress-bar"
                        role="progressbar"
                        aria-label={`${project.name}进度`}
                        aria-valuenow={currentStep.workDone}
                        aria-valuemin={0}
                        aria-valuemax={currentStep.workRequired}
                        aria-valuetext={`${progressPercent}%`}
                      >
                        <span className="base-progress-fill" style={{ width: `${progressPercent}%` }} />
                      </span>
                      <span className="base-progress-text">
                        {currentStep.workDone}/{currentStep.workRequired}
                      </span>
                    </span>
                  ) : null}
                  {blockedLabel ? (
                    <span className="base-blocked-reason">受阻：{blockedLabel}</span>
                  ) : null}
                  {idleNote ? <span className="base-blocked-reason">{idleNote}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
