import type { AiCallPurpose } from "@ai-mud/shared";
import { describe, expect, it } from "vitest";
import { AI_PURPOSE_POLICIES } from "./ai-purpose-policy.js";

const knownPurposes: AiCallPurpose[] = [
  "npc_dialogue",
  "npc_task_copy",
  "npc_memory_compression",
  "world_rumor"
];

describe("AI purpose policy registry", () => {
  it("covers every existing AI purpose", () => {
    expect(Object.keys(AI_PURPOSE_POLICIES).sort()).toEqual([...knownPurposes].sort());
  });

  it("keeps all current AI purposes read-only with fallback paths", () => {
    for (const policy of Object.values(AI_PURPOSE_POLICIES)) {
      expect(policy.mutatesWorldState).toBe(false);
      expect(policy.allowedStateEffects).toBe("none");
      expect(policy.fallbackRequired).toBe(true);
    }
  });

  it("defines a short NPC dialogue cooldown", () => {
    expect(AI_PURPOSE_POLICIES.npc_dialogue.cooldownMs).toBe(5000);
    expect(AI_PURPOSE_POLICIES.npc_dialogue.maxOutputTokens).toBe(180);
  });
}
);
