import type { HotkeyRegistry, InputContextScope } from "./HotkeyRegistry";

const inputContextPriority: InputContextScope[] = ["text-entry", "modal", "panel", "global"];

export function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

export function resolveInputContext(scopes: InputContextScope[]) {
  return inputContextPriority.find((scope) => scopes.includes(scope)) ?? "global";
}

export function getInputContextScopes(
  event: KeyboardEvent,
  options: { isModalOpen: boolean; isPanelFocused?: boolean }
): InputContextScope[] {
  const scopes: InputContextScope[] = ["global"];
  if (options.isPanelFocused) scopes.push("panel");
  if (options.isModalOpen) scopes.push("modal");
  if (isTextEntryTarget(event.target)) scopes.push("text-entry");
  return scopes;
}

export function dispatchHotkey(
  registry: HotkeyRegistry,
  key: string,
  activeScopes: InputContextScope[]
) {
  const activeScope = resolveInputContext(activeScopes);
  if (activeScope === "text-entry") return false;

  const record = registry.find(key, activeScope);
  if (!record) return false;

  record.handler();
  return true;
}
