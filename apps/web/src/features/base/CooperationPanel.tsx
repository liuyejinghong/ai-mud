// 协作请求与候选都来自快照；选择交给服务端重验。
import type { BaseDeviceDto, CooperationRequestDto, CooperationStatus } from "@ai-mud/shared";
import { BASE_ROBOT_GROUP_NAMES } from "@ai-mud/shared";

export const COOPERATION_STATUS_LABELS: Record<CooperationStatus, string> = {
  pending: "等待支援",
  accepted: "支援已接受",
  declined: "已婉拒",
  expired: "已超时",
  fulfilled: "已完成"
};

const CLOSE_REASON_LABELS: Record<string, string> = {
  ttl_expired: "已超时",
  project_cancelled: "工程已取消",
  project_failed: "工程已失败",
  step_failed: "步骤已失败",
  content_missing: "内容暂不可用",
  no_longer_needed: "本组已恢复，无需支援"
};

function describeGroupId(groupId: string): string {
  const label = (BASE_ROBOT_GROUP_NAMES as Record<string, string>)[groupId];
  return label ?? groupId;
}

export interface CooperationPanelProps {
  requests: CooperationRequestDto[];
  devices: BaseDeviceDto[];
  isBusy?: boolean;
  onDecision?: (requestId: string, action: "support" | "wait", expectedHelperOperatorId?: string) => void;
  feedback?: { kind: "pending" | "success" | "error"; message: string } | null;
}

export function CooperationPanel({ requests, devices, isBusy = false, onDecision, feedback = null }: CooperationPanelProps) {
  const active = requests.filter((request) => request.status === "pending" || request.status === "accepted");
  const history = requests.filter((request) => request.status !== "pending" && request.status !== "accepted");
  const declined = history.filter((request) => request.status === "declined").length;
  const expired = history.filter((request) =>
    request.status === "expired" && (!request.resolutionReason || request.resolutionReason === "ttl_expired")
  ).length;
  const closed = history.filter((request) =>
    request.status === "expired" && request.resolutionReason && request.resolutionReason !== "ttl_expired"
  ).length;
  const deviceNames = new Map(devices.map((device) => [device.operatorId, device.name]));
  const requestItem = (request: CooperationRequestDto) => {
    const helper = request.proposedHelper;
    return (
    <li
      key={request.requestId}
      className={`base-cooperation-item base-cooperation-${request.status}`}
    >
      <span className="base-cooperation-target">
        {request.projectName || "原工程"} · 第 {request.stepIndex + 1} 步
      </span>
      <span className="base-cooperation-status">
        {request.resolutionReason
          ? CLOSE_REASON_LABELS[request.resolutionReason]
          : COOPERATION_STATUS_LABELS[request.status]}
      </span>
      <span className="base-cooperation-question">{request.question}</span>
      {request.status === "pending" && request.playerDecisionAllowed && onDecision ? (
        <>
          <span className="base-cooperation-helper">
            {helper
              ? `可调配：${describeGroupId(helper.groupId)}的${deviceNames.get(helper.operatorId) ?? "候选机器人"} · 电量 ${helper.batteryWh}/${helper.batteryCapacityWh} Wh`
              : "当前没有符合条件的跨组机器人，可以等待本组充电。"}
          </span>
          <span className="base-copy">支援会调配这台机器人；等待则让本组自行恢复。进度以基地状态为准。</span>
          <span className="base-cooperation-actions">
            <button type="button" className="base-primary-button"
              disabled={isBusy || helper === null}
              onClick={() => helper && onDecision(request.requestId, "support", helper.operatorId)}
            >批准跨组支援</button>
            <button type="button" className="base-primary-button" disabled={isBusy}
              onClick={() => onDecision(request.requestId, "wait")}
            >等待本组充电</button>
          </span>
        </>
      ) : null}
      {request.status === "accepted" ? (
        <span className="base-cooperation-helper">
          {request.helperOperatorId !== null && deviceNames.has(request.helperOperatorId)
            ? `已由${describeGroupId(request.helperGroupId)}的${deviceNames.get(request.helperOperatorId)}接手支援`
            : `已由${describeGroupId(request.helperGroupId)}接手支援`}
        </span>
      ) : null}
      <details>
        <summary>查看请求来源</summary>
        <p>
          请求 ID：<code>{request.requestId}</code> · 项目 ID：<code>{request.projectId}</code>
          {request.helperOperatorId !== null ? <> · 操作员 ID：<code>{request.helperOperatorId}</code></> : null}
          <br />创建时间：<time dateTime={request.createdAt}>{request.createdAt}</time>
        </p>
      </details>
    </li>
    );
  };

  return (
    <section className="base-panel base-cooperation" aria-label="协作请求">
      <h2 className="base-panel-title">协作请求</h2>
      <p className="base-copy">
        工程组缺工时可处理首次支援请求；后续进展由基地调度并显示在这里。
      </p>
      {feedback ? <p className="base-task-feedback" role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p> : null}
      {active.length > 0 ? (
        <ul className="base-cooperation-list">{active.map(requestItem)}</ul>
      ) : (
        <p className="base-copy">
          {requests.length === 0 ? "目前没有协作请求。" : "目前没有进行中的支援请求。"}
        </p>
      )}
      {history.length > 0 ? (
        <details className="base-cooperation-history">
          <summary>
            协作历史 {history.length} 条
            {declined > 0 ? ` · 已婉拒 ${declined} 条` : ""}
            {expired > 0 ? ` · 已超时 ${expired} 条` : ""}
            {closed > 0 ? ` · 已结案 ${closed} 条` : ""}
          </summary>
          <ul className="base-cooperation-list">{history.map(requestItem)}</ul>
        </details>
      ) : null}
    </section>
  );
}
