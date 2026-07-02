import { describe, expect, it } from "vitest";
import {
  accounts,
  activationCodes,
  aiCallLogs,
  auditLogs,
  characterActions,
  characterActionStatus,
  characterActionType,
  characterEquipment,
  characterItems,
  characters,
  gameEvents,
  marketInventory,
  marketTransactions,
  municipalTreasury,
  npcActions,
  npcDialogueMessages,
  npcEvents,
  npcItems,
  npcMemoryEntries,
  npcMemoryFragments,
  npcRelationships,
  npcTasks,
  mapInstances,
  sessions,
  worldActors,
  worldResourceNodes,
  worldRuntimeState,
  worldRumors
} from "./schema.js";

function getDrizzleTableName(table: unknown) {
  return (table as Record<symbol, string>)[Symbol.for("drizzle:Name")];
}

describe("foundation schema", () => {
  it("defines the core auth/admin tables", () => {
    expect(getDrizzleTableName(accounts)).toBe("accounts");
    expect(getDrizzleTableName(activationCodes)).toBe("activation_codes");
    expect(getDrizzleTableName(sessions)).toBe("sessions");
    expect(getDrizzleTableName(auditLogs)).toBe("audit_logs");
  });

  it("defines the first playable world state tables", () => {
    expect(getDrizzleTableName(characters)).toBe("characters");
    expect(getDrizzleTableName(characterItems)).toBe("character_items");
    expect(getDrizzleTableName(characterEquipment)).toBe("character_equipment");
    expect(getDrizzleTableName(characterActions)).toBe("character_actions");
    expect(getDrizzleTableName(marketInventory)).toBe("market_inventory");
    expect(getDrizzleTableName(marketTransactions)).toBe("market_transactions");
    expect(getDrizzleTableName(mapInstances)).toBe("map_instances");
    expect(getDrizzleTableName(gameEvents)).toBe("game_events");
  });

  it("defines the Living NPC world tables", () => {
    expect(getDrizzleTableName(worldActors)).toBe("world_actors");
    expect(getDrizzleTableName(npcItems)).toBe("npc_items");
    expect(getDrizzleTableName(npcActions)).toBe("npc_actions");
    expect(getDrizzleTableName(npcEvents)).toBe("npc_events");
    expect(getDrizzleTableName(worldResourceNodes)).toBe("world_resource_nodes");
    expect(getDrizzleTableName(municipalTreasury)).toBe("municipal_treasury");
  });

  it("stores character money as copper", () => {
    expect(characters.copperBalance.getSQLType()).toBe("integer");
  });

  it("stores character hunger needs", () => {
    expect(characters.hunger.getSQLType()).toBe("integer");
    expect(characters.lastHungerSettledAt.getSQLType()).toBe("timestamp with time zone");
  });

  it("stores equipment durability as per-character item instances", () => {
    expect(characterEquipment.slot.getSQLType()).toBe("text");
    expect(characterEquipment.currentDurability.getSQLType()).toBe("integer");
    expect(characterEquipment.maxDurability.getSQLType()).toBe("integer");
  });

  it("defines active action enums", () => {
    expect(characterActionType.enumValues).toEqual(["gathering", "combat"]);
    expect(characterActionStatus.enumValues).toEqual(["active", "completed", "cancelled"]);
  });

  it("stores NPC actor state and actor-aware market transactions", () => {
    expect(worldActors.actorType.getSQLType()).toBe("text");
    expect(worldActors.npcKey.getSQLType()).toBe("text");
    expect(worldActors.copperBalance.getSQLType()).toBe("integer");
    expect(worldActors.hunger.getSQLType()).toBe("integer");
    expect(npcActions.actionType.getSQLType()).toBe("text");
    expect(worldResourceNodes.charges.getSQLType()).toBe("integer");
    expect(municipalTreasury.copperBalance.getSQLType()).toBe("integer");
    expect(marketTransactions.actorType.getSQLType()).toBe("text");
    expect(marketTransactions.actorId.getSQLType()).toBe("text");
    expect(marketTransactions.actorName.getSQLType()).toBe("text");
  });

  it("defines world runtime state for automatic settlement", () => {
    expect(getDrizzleTableName(worldRuntimeState)).toBe("world_runtime_state");
    expect(worldRuntimeState.key.getSQLType()).toBe("text");
    expect(worldRuntimeState.lastSettledAt.getSQLType()).toBe("timestamp with time zone");
    expect(worldRuntimeState.leaseOwner.getSQLType()).toBe("text");
    expect(worldRuntimeState.leaseUntil.getSQLType()).toBe("timestamp with time zone");
  });

  it("defines AI dialogue and audit tables", () => {
    expect(getDrizzleTableName(aiCallLogs)).toBe("ai_call_logs");
    expect(getDrizzleTableName(npcDialogueMessages)).toBe("npc_dialogue_messages");
    expect(getDrizzleTableName(npcRelationships)).toBe("npc_relationships");
    expect(aiCallLogs.provider.getSQLType()).toBe("text");
    expect(aiCallLogs.model.getSQLType()).toBe("text");
    expect(aiCallLogs.promptVersion.getSQLType()).toBe("integer");
    expect(aiCallLogs.status.getSQLType()).toBe("text");
    expect(npcDialogueMessages.speakerType.getSQLType()).toBe("text");
    expect(npcDialogueMessages.message.getSQLType()).toBe("text");
    expect(npcRelationships.familiarity.getSQLType()).toBe("integer");
    expect(npcRelationships.trust.getSQLType()).toBe("integer");
  });

  it("defines world rumors for player-visible event flavor", () => {
    expect(getDrizzleTableName(worldRumors)).toBe("world_rumors");
    expect(worldRumors.sourceType.getSQLType()).toBe("text");
    expect(worldRumors.sourceId.getSQLType()).toBe("uuid");
    expect(worldRumors.settlementId.getSQLType()).toBe("text");
    expect(worldRumors.audience.getSQLType()).toBe("text");
    expect(worldRumors.message.getSQLType()).toBe("text");
    expect(worldRumors.tags.getSQLType()).toBe("jsonb");
    expect(worldRumors.generatedBy.getSQLType()).toBe("text");
    expect(worldRumors.expiresAt.getSQLType()).toBe("timestamp with time zone");
  });

  it("defines NPC memory entry and fragment tables", () => {
    expect(getDrizzleTableName(npcMemoryEntries)).toBe("npc_memory_entries");
    expect(getDrizzleTableName(npcMemoryFragments)).toBe("npc_memory_fragments");
    expect(npcMemoryEntries.evidenceLevel.getSQLType()).toBe("text");
    expect(npcMemoryEntries.sourceIds.getSQLType()).toBe("jsonb");
    expect(npcMemoryEntries.summary.getSQLType()).toBe("text");
    expect(npcMemoryEntries.importance.getSQLType()).toBe("integer");
    expect(npcMemoryEntries.compressedAt.getSQLType()).toBe("timestamp with time zone");
    expect(npcMemoryFragments.evidenceLevel.getSQLType()).toBe("text");
    expect(npcMemoryFragments.sourceEntryIds.getSQLType()).toBe("jsonb");
    expect(npcMemoryFragments.summary.getSQLType()).toBe("text");
    expect(npcMemoryFragments.compressionLevel.getSQLType()).toBe("integer");
  });

  it("defines NPC demand task tables with escrowed rewards", () => {
    expect(getDrizzleTableName(npcTasks)).toBe("npc_tasks");
    expect(npcTasks.needType.getSQLType()).toBe("text");
    expect(npcTasks.status.getSQLType()).toBe("text");
    expect(npcTasks.requestedItemId.getSQLType()).toBe("text");
    expect(npcTasks.requestedQuantity.getSQLType()).toBe("integer");
    expect(npcTasks.rewardCopper.getSQLType()).toBe("integer");
    expect(npcTasks.escrowCopper.getSQLType()).toBe("integer");
    expect(npcTasks.proposalSource.getSQLType()).toBe("text");
    expect(npcTasks.proposalReason.getSQLType()).toBe("text");
    expect(npcTasks.acceptedByCharacterId.getSQLType()).toBe("uuid");
    expect(npcTasks.expiresAt.getSQLType()).toBe("timestamp with time zone");
  });

  it("stores audit metadata as structured jsonb", () => {
    const auditTable = auditLogs as unknown as {
      metadata: { getSQLType(): string };
      metadataJson?: unknown;
    };

    expect(auditTable.metadata.getSQLType()).toBe("jsonb");
    expect(auditTable.metadataJson).toBeUndefined();
  });
});
