import type { GameLogEntryDto } from "@ai-mud/shared";
import { formatEventTime } from "./panelFormatters";

export interface EventLogPanelProps {
  entries: readonly GameLogEntryDto[];
  totalEntryCount?: number;
  formatTime?: (createdAt: string) => string;
}

export function EventLogPanel({
  entries,
  totalEntryCount,
  formatTime = formatEventTime
}: EventLogPanelProps) {
  return (
    <section className="event-log-panel" aria-labelledby="event-log-title">
      <div className="panel-heading">
        <h2 id="event-log-title">事件记录</h2>
        <span>
          最近 {entries.length}
          {totalEntryCount === undefined ? "" : `/${totalEntryCount}`}
        </span>
      </div>
      <ol
        className="game-log"
        aria-label="最近事件记录"
        role="log"
        aria-live="polite"
        tabIndex={0}
      >
        {entries.map((entry) => (
          <li className="event-log-entry" key={entry.id}>
            <time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time>
            <span>{entry.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
