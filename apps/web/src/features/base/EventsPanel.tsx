// D013-ui：事件记录面板。消费冻结契约 1 的 GET /base/events（A 线实现）。
// 设计约束：折叠面板挂在右栏底部（面板内部滚动，不破坏固定工作区 L001）；
// 端点 404/任何失败时整个面板隐藏（不报错弹窗）——旧服务端没有该端点也照常可玩。
import { useEffect, useState } from "react";
import { getBaseEvents, type BaseEventDto } from "./baseApi.js";

const EVENT_TYPE_LABELS: Record<string, string> = {
  "project.completed": "工程完工",
  "manufacturing.completed": "制造完工",
  "extraction.delivered": "采矿送达",
  "order.delivered": "订单交付"
};

function eventTag(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

// 事件时间取基地时间（simTime 的 UTC 小时即昼夜基准），显示 月-日 时:分。
function formatEventTime(simTime: string): string {
  const date = new Date(simTime);
  if (Number.isNaN(date.getTime())) return simTime;
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export interface EventsPanelProps {
  csrfToken: string | null | undefined;
  // 快照更新时刷新：传 baseRevision 等随事实变化的键。
  refreshKey?: number | string | undefined;
  limit?: number | undefined;
}

export function EventsPanel({ csrfToken, refreshKey, limit = 100 }: EventsPanelProps) {
  const [events, setEvents] = useState<BaseEventDto[] | null>(null);

  useEffect(() => {
    if (!csrfToken) return;
    const token: string = csrfToken;
    let cancelled = false;
    getBaseEvents(token, limit)
      .then((result) => {
        if (!cancelled) setEvents(result.events);
      })
      .catch(() => {
        // 优雅降级：端点缺失（404）或失败 → 隐藏面板，不打扰玩家。
        if (!cancelled) setEvents(null);
      });
    return () => {
      cancelled = true;
    };
  }, [csrfToken, refreshKey, limit]);

  if (!csrfToken || events === null || events.length === 0) return null;
  return (
    <details className="landing-events">
      <summary>事件记录（{events.length}）</summary>
      <ul className="landing-event-list">
        {events.map((event) => (
          <li key={event.id}>
            <span className={`landing-event-tag${EVENT_TYPE_LABELS[event.type] ? "" : " is-other"}`}>
              {eventTag(event.type)}
            </span>
            <span className="landing-event-title">{event.title}</span>
            {event.detail ? <span className="landing-dim">{event.detail}</span> : null}
            <span className="landing-dim landing-event-time">{formatEventTime(event.simTime)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
