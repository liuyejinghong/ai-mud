import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const modulesDir = resolve(currentDir, "..");

const businessServiceFiles = [
  resolve(modulesDir, "game/game.service.ts"),
  resolve(modulesDir, "npc-task/npc-task.service.ts"),
  resolve(modulesDir, "dialogue/dialogue.service.ts")
];

describe("item asset write path architecture", () => {
  it("keeps business services off legacy direct inventory write methods", () => {
    const forbiddenCalls = [
      ".setInventoryItem(",
      ".decrementInventoryItem(",
      ".setCharacterInventoryItem(",
      ".setNpcInventoryItem("
    ];

    for (const file of businessServiceFiles) {
      const source = readFileSync(file, "utf8");
      for (const forbiddenCall of forbiddenCalls) {
        expect(source, `${file} must not call ${forbiddenCall}`).not.toContain(forbiddenCall);
      }
    }
  });
});
