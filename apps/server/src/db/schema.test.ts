import { describe, expect, it } from "vitest";
import {
  accounts,
  activationCodes,
  auditLogs,
  characterActions,
  characterActionStatus,
  characterActionType,
  characterItems,
  characters,
  gameEvents,
  marketInventory,
  marketTransactions,
  mapInstances,
  sessions
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
    expect(getDrizzleTableName(characterActions)).toBe("character_actions");
    expect(getDrizzleTableName(marketInventory)).toBe("market_inventory");
    expect(getDrizzleTableName(marketTransactions)).toBe("market_transactions");
    expect(getDrizzleTableName(mapInstances)).toBe("map_instances");
    expect(getDrizzleTableName(gameEvents)).toBe("game_events");
  });

  it("stores character money as copper", () => {
    expect(characters.copperBalance.getSQLType()).toBe("integer");
  });

  it("defines active action enums", () => {
    expect(characterActionType.enumValues).toEqual(["gathering", "combat"]);
    expect(characterActionStatus.enumValues).toEqual(["active", "completed", "cancelled"]);
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
