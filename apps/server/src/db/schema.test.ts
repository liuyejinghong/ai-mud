import { describe, expect, it } from "vitest";
import {
  accounts,
  activationCodes,
  auditLogs,
  characterItems,
  characters,
  gameEvents,
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
    expect(getDrizzleTableName(mapInstances)).toBe("map_instances");
    expect(getDrizzleTableName(gameEvents)).toBe("game_events");
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
