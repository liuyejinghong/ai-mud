import { describe, expect, it } from "vitest";
import { createDb } from "./client.js";

describe("database client", () => {
  it("returns a close handle for the pg pool lifecycle", async () => {
    const connection = createDb("postgres://postgres:postgres@127.0.0.1:5432/ai_mud");

    expect(connection.db).toBeDefined();
    expect(connection.pool).toBeDefined();
    expect(typeof connection.close).toBe("function");

    await connection.close();
  });
});
