import { describe, expect, it, vi } from "vitest";
import { HotkeyRegistry } from "./HotkeyRegistry";
import { dispatchHotkey } from "./InputContext";

describe("HotkeyRegistry", () => {
  it("stores hotkeys as documentation-ready records", () => {
    const registry = new HotkeyRegistry();

    registry.register({
      key: "W",
      contextScope: "global",
      action: "move:north",
      description: "向北移动",
      handler: vi.fn()
    });

    expect(registry.getRecords()).toEqual([
      expect.objectContaining({
        key: "w",
        contextScope: "global",
        action: "move:north",
        description: "向北移动"
      })
    ]);
  });

  it("keeps movement shortcuts only in the global context", () => {
    const registry = new HotkeyRegistry();
    const movementKeys = ["w", "a", "s", "d"];

    for (const key of movementKeys) {
      registry.register({
        key,
        contextScope: "global",
        action: `move:${key}`,
        description: `移动 ${key}`,
        handler: vi.fn()
      });
    }

    const registeredMovementKeys = registry
      .getRecords()
      .filter((record) => movementKeys.includes(record.key));

    expect(
      registeredMovementKeys.every((record) => record.contextScope === "global")
    ).toBe(true);
  });
});

describe("dispatchHotkey", () => {
  it("uses text-entry > modal > panel > global priority and does not fall back", () => {
    const registry = new HotkeyRegistry();
    const move = vi.fn();
    const closeModal = vi.fn();

    registry.register({
      key: "w",
      contextScope: "global",
      action: "move:north",
      description: "向北移动",
      handler: move
    });
    registry.register({
      key: "escape",
      contextScope: "modal",
      action: "modal:close",
      description: "关闭弹层",
      handler: closeModal
    });

    expect(dispatchHotkey(registry, "w", ["modal", "global"])).toBe(false);
    expect(dispatchHotkey(registry, "escape", ["modal", "global"])).toBe(true);
    expect(dispatchHotkey(registry, "escape", ["text-entry", "modal", "global"])).toBe(false);
    expect(move).not.toHaveBeenCalled();
    expect(closeModal).toHaveBeenCalledTimes(1);
  });
});
