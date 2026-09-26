import { describe, expect, it } from "vitest";
import { createDb, dbPoolOptionsFromEnv, DEFAULT_DB_POOL_OPTIONS } from "./client.js";

describe("database client", () => {
  it("returns a close handle for the pg pool lifecycle", async () => {
    const connection = createDb("postgres://postgres:postgres@127.0.0.1:5432/ai_mud");

    expect(connection.db).toBeDefined();
    expect(connection.pool).toBeDefined();
    expect(typeof connection.close).toBe("function");

    await connection.close();
  });

  // 车道 C5（ARCH-domain-08）：pg.Pool 缺省 connectionTimeoutMillis=0（无限等待），库侧无语句/事务空闲超时。
  it("bounds pool acquisition, statements and idle transactions by default", async () => {
    const connection = createDb("postgres://postgres:postgres@127.0.0.1:5432/ai_mud");
    const options = connection.pool.options as unknown as Record<string, unknown>;

    expect(DEFAULT_DB_POOL_OPTIONS).toEqual({
      max: 10,
      connectionTimeoutMillis: 10_000,
      statementTimeoutMs: 30_000,
      idleInTransactionSessionTimeoutMs: 30_000
    });
    expect(options.max).toBe(10);
    expect(options.connectionTimeoutMillis).toBe(10_000);
    expect(options.statement_timeout).toBe(30_000);
    expect(options.idle_in_transaction_session_timeout).toBe(30_000);

    await connection.close();
  });

  it("applies explicit pool and timeout overrides", async () => {
    const connection = createDb("postgres://postgres:postgres@127.0.0.1:5432/ai_mud", {
      max: 3,
      connectionTimeoutMillis: 1_500,
      statementTimeoutMs: 2_500,
      idleInTransactionSessionTimeoutMs: 4_000
    });
    const options = connection.pool.options as unknown as Record<string, unknown>;

    expect(options.max).toBe(3);
    expect(options.connectionTimeoutMillis).toBe(1_500);
    expect(options.statement_timeout).toBe(2_500);
    expect(options.idle_in_transaction_session_timeout).toBe(4_000);

    await connection.close();
  });

  it("maps env settings onto pool options, leaving unset values to the defaults", async () => {
    expect(
      dbPoolOptionsFromEnv({
        DB_POOL_MAX: 12,
        DB_POOL_CONNECTION_TIMEOUT_MS: undefined,
        DB_STATEMENT_TIMEOUT_MS: 9_000,
        DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: undefined
      })
    ).toEqual({
      max: 12,
      connectionTimeoutMillis: undefined,
      statementTimeoutMs: 9_000,
      idleInTransactionSessionTimeoutMs: undefined
    });

    const connection = createDb(
      "postgres://postgres:postgres@127.0.0.1:5432/ai_mud",
      dbPoolOptionsFromEnv({ DB_STATEMENT_TIMEOUT_MS: 9_000 })
    );
    const options = connection.pool.options as unknown as Record<string, unknown>;
    expect(options.statement_timeout).toBe(9_000);
    expect(options.connectionTimeoutMillis).toBe(10_000);
    await connection.close();
  });
});
