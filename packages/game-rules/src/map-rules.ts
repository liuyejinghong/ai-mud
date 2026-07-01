import type { ZoneDefinition } from "@ai-mud/content";
import type { Direction, GridPositionDto, MapCellDto } from "@ai-mud/shared";

export type MoveResult =
  | { ok: true; position: GridPositionDto }
  | { ok: false; reason: "OUT_OF_BOUNDS" };

export function movePosition(
  zone: ZoneDefinition,
  current: GridPositionDto,
  direction: Direction
): MoveResult {
  const next = { ...current };
  if (direction === "north") next.y -= 1;
  if (direction === "south") next.y += 1;
  if (direction === "west") next.x -= 1;
  if (direction === "east") next.x += 1;

  if (next.x < 0 || next.y < 0 || next.x >= zone.width || next.y >= zone.height) {
    return { ok: false, reason: "OUT_OF_BOUNDS" };
  }

  return { ok: true, position: next };
}

export function buildMapCells(
  zone: ZoneDefinition,
  playerPosition: GridPositionDto,
  resourceCharges: Record<string, number>
): MapCellDto[] {
  const cells: MapCellDto[] = [];

  for (let y = 0; y < zone.height; y += 1) {
    for (let x = 0; x < zone.width; x += 1) {
      const markers: MapCellDto["markers"] = [];
      const hasPlayer = playerPosition.x === x && playerPosition.y === y;
      const hasExit = zone.exits.some((exit) => exit.position.x === x && exit.position.y === y);
      const hasResource = zone.resources.some(
        (resource) =>
          resource.position.x === x &&
          resource.position.y === y &&
          (resourceCharges[resource.id] ?? resource.charges) > 0
      );
      const hasEncounter = zone.encounters.some(
        (encounter) => encounter.position.x === x && encounter.position.y === y
      );

      if (hasPlayer) markers.push("player");
      if (hasResource) markers.push("resource");
      if (hasEncounter) markers.push("encounter");
      if (hasExit) markers.push("exit");
      if (markers.length === 0) markers.push("ordinary");

      cells.push({ x, y, markers });
    }
  }

  return cells;
}
