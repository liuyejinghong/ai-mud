import {
  NPC_DIALOGUE_PROMPT_VERSION,
  NPC_MEMORY_COMPRESSION_PROMPT_VERSION,
  NPC_TASK_PROPOSAL_PROMPT_VERSION,
  NPC_TASK_COPY_PROMPT_VERSION,
  OFFLINE_SUMMARY_PROMPT_VERSION,
  WORLD_RUMOR_PROMPT_VERSION
} from "@ai-mud/ai-prompts";
import type { AiAuthorityClass, AiCallPurpose } from "@ai-mud/shared";

export interface AiPurposePolicy {
  purpose: AiCallPurpose;
  authorityClass: AiAuthorityClass;
  mutatesWorldState: false;
  maxOutputTokens: number;
  cooldownMs: number;
  fallbackRequired: true;
  promptVersion: number;
  allowedStateEffects: "none";
}

export const AI_PURPOSE_POLICIES: Record<AiCallPurpose, AiPurposePolicy> = {
  npc_dialogue: {
    purpose: "npc_dialogue",
    authorityClass: "presentation",
    mutatesWorldState: false,
    maxOutputTokens: 180,
    cooldownMs: 5000,
    fallbackRequired: true,
    promptVersion: NPC_DIALOGUE_PROMPT_VERSION,
    allowedStateEffects: "none"
  },
  npc_task_copy: {
    purpose: "npc_task_copy",
    authorityClass: "presentation",
    mutatesWorldState: false,
    maxOutputTokens: 180,
    cooldownMs: 0,
    fallbackRequired: true,
    promptVersion: NPC_TASK_COPY_PROMPT_VERSION,
    allowedStateEffects: "none"
  },
  npc_memory_compression: {
    purpose: "npc_memory_compression",
    authorityClass: "summary",
    mutatesWorldState: false,
    maxOutputTokens: 260,
    cooldownMs: 0,
    fallbackRequired: true,
    promptVersion: NPC_MEMORY_COMPRESSION_PROMPT_VERSION,
    allowedStateEffects: "none"
  },
  world_rumor: {
    purpose: "world_rumor",
    authorityClass: "presentation",
    mutatesWorldState: false,
    maxOutputTokens: 120,
    cooldownMs: 0,
    fallbackRequired: true,
    promptVersion: WORLD_RUMOR_PROMPT_VERSION,
    allowedStateEffects: "none"
  },
  npc_task_proposal: {
    purpose: "npc_task_proposal",
    authorityClass: "classification",
    mutatesWorldState: false,
    maxOutputTokens: 220,
    cooldownMs: 0,
    fallbackRequired: true,
    promptVersion: NPC_TASK_PROPOSAL_PROMPT_VERSION,
    allowedStateEffects: "none"
  },
  offline_summary: {
    purpose: "offline_summary",
    authorityClass: "summary",
    mutatesWorldState: false,
    maxOutputTokens: 240,
    cooldownMs: 0,
    fallbackRequired: true,
    promptVersion: OFFLINE_SUMMARY_PROMPT_VERSION,
    allowedStateEffects: "none"
  }
};

export const AI_PURPOSE_ORDER: AiCallPurpose[] = [
  "npc_dialogue",
  "npc_task_copy",
  "npc_memory_compression",
  "world_rumor",
  "npc_task_proposal",
  "offline_summary"
];
