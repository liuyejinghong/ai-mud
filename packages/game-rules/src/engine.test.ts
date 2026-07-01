import { describe, expect, it } from "vitest";
import { CORRUPT_FOREST } from "@ai-mud/content";
import { addInventoryItem, buildMapCells, movePosition } from "./index.js";

describe("v0.2 engine rules", () => {
  it("moves inside the Corrupt Forest boundaries", () => {
    expect(movePosition(CORRUPT_FOREST, { x: 2, y: 4 }, "north")).toEqual({
      ok: true,
      position: { x: 2, y: 3 }
    });
  });

  it("rejects movement outside map boundaries", () => {
    expect(movePosition(CORRUPT_FOREST, { x: 0, y: 0 }, "west")).toEqual({
      ok: false,
      reason: "OUT_OF_BOUNDS"
    });
  });

  it("adds stackable inventory items", () => {
    expect(addInventoryItem([{ itemId: "wild_berry", quantity: 1 }], "wild_berry", 2)).toEqual([
      { itemId: "wild_berry", quantity: 3 }
    ]);
  });

  it("marks player, resource, and exit cells", () => {
    const cells = buildMapCells(CORRUPT_FOREST, { x: 2, y: 4 }, {
      forest_berry_patch_01: 3
    });
    expect(cells.find((cell) => cell.x === 2 && cell.y === 4)?.markers).toContain("player");
    expect(cells.find((cell) => cell.x === 1 && cell.y === 3)?.markers).toContain("resource");
  });
});
