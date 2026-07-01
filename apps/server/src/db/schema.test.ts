import { describe, expect, it } from "vitest";
import {
  accounts,
  activationCodes,
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
  npcEvents,
  npcItems,
  mapInstances,
  sessions,
  worldActors,
  worldResourceNodes
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

  it("stores audit metadata as structured jsonb", () => {
    const auditTable = auditLogs as unknown as {
      metadata: { getSQLType(): string };
      metadataJson?: unknown;
    };

    expect(auditTable.metadata.getSQLType()).toBe("jsonb");
    expect(auditTable.metadataJson).toBeUndefined();
  });
});
