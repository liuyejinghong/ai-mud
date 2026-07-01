import { describe, expect, it } from "vitest";
import { accounts, activationCodes, auditLogs, sessions } from "./schema.js";

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
});
