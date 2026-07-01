import type { NpcDialoguePromptContext } from "@ai-mud/ai-prompts";

export function buildTemplateNpcReply(context: NpcDialoguePromptContext): string {
  if (context.npc.profession === "blacksmith") {
    return "炉火还没灭。基础铁矿石越少，修装备就越难。你若去旧矿脉，带些矿回来。";
  }

  if (context.npc.profession === "municipal_officer") {
    return "黑松哨站靠粮食、矿石和税账撑着。若集市短缺，市政厅会优先稳住供给。";
  }

  return `${context.npc.name}看了你一眼，低声说现在不方便细谈。`;
}
