import type { MapCellDto } from "@ai-mud/shared";

const eventTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

export function formatEventTime(createdAt: string) {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) return "--:--";
  return eventTimeFormatter.format(timestamp);
}

export function clampProgressPct(progressPct: number) {
  if (!Number.isFinite(progressPct)) return 0;
  return Math.min(100, Math.max(0, progressPct));
}

export function mapCellText(markers: ReadonlyArray<MapCellDto["markers"][number]>) {
  if (markers.includes("player")) return "@";
  if (markers.includes("encounter")) return "!";
  if (markers.includes("resource")) return "*";
  if (markers.includes("exit")) return "E";
  return ".";
}
