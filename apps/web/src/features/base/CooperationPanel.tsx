// 协作请求面板：展示工程队内部跨组支援请求的进展。数据一律来自快照，不在客户端推算。
// 玩家只读：这里不做任何接受/婉拒操作，是否支援由基地调度服务端决定。
import type { BaseDeviceDto, CooperationRequestDto, CooperationStatus } from "@ai-mud/shared";
import { BASE_ROBOT_GROUP_NAMES } from "@ai-mud/shared";

export const COOPERATION_STATUS_LABELS: Record<CooperationStatus, string> = {
  pending: "等待支援",
  accepted: "支援已接受",
  declined: "已婉拒",
  expired: "已超时",
  fulfilled: "已完成"
};

function describeGroupId(groupId: string): string {
  const label = (BASE_ROBOT_GROUP_NAMES as Record<string, string>)[groupId];
  return label ?? groupId;
}

export interface CooperationPanelProps {
  requests: CooperationRequestDto[];
  devices: BaseDeviceDto[];
}

export function CooperationPanel({ requests, devices }: CooperationPanelProps) {
  if (requests.length === 0) {
    return null;
  }

  const active = requests.filter((request) => request.status === "pending" || request.status === "accepted");
  const history = requests.filter((request) => request.status !== "pending" && request.status !== "accepted");
  const declined = history.filter((request) => request.status === "declined").length;
  const expired = history.filter((request) => request.status === "expired").length;
  const deviceNames = new Map(devices.map((device) => [device.operatorId, device.name]));
  const requestItem = (request: CooperationRequestDto) => (
    <li
      key={request.requestId}
      className={`base-cooperation-item base-cooperation-${request.status}`}
    >
      <span className="base-cooperation-target">
        {request.projectName || "原工程"} · 第 {request.stepIndex + 1} 步
      </span>
      <span className="base-cooperation-status">
        {COOPERATION_STATUS_LABELS[request.status]}
      </span>
      <span className="base-cooperation-question">{request.question}</span>
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

  return (
    <section className="base-panel base-cooperation" aria-label="协作请求">
      <h2 className="base-panel-title">协作请求</h2>
      <p className="base-copy">
        工程组施工时会请求其他小组支援。这里显示每次支援请求的进展，是否派人由基地自动调度。
      </p>
      {active.length > 0 ? (
        <ul className="base-cooperation-list">{active.map(requestItem)}</ul>
      ) : (
        <p className="base-copy">目前没有进行中的支援请求。</p>
      )}
      {history.length > 0 ? (
        <details className="base-cooperation-history">
          <summary>
            协作历史 {history.length} 条
            {declined > 0 ? ` · 已婉拒 ${declined} 条` : ""}
            {expired > 0 ? ` · 已超时 ${expired} 条` : ""}
          </summary>
          <ul className="base-cooperation-list">{history.map(requestItem)}</ul>
        </details>
      ) : null}
    </section>
  );
}
