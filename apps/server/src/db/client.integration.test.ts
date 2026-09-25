import { describe, expect, it } from "vitest";
import { createDb } from "./client.js";

// 车道 C5 真 PG 验收（评审 ARCH-domain-08）：连接池获取有上限等待，会话带 statement_timeout 与
// idle_in_transaction_session_timeout。只读探针（SHOW / pg_sleep），不建表、不写数据。

const DATABASE_URL = process.env.DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

d("database client timeouts (PostgreSQL)", () => {
  it("opens sessions with bounded statement and idle-in-transaction timeouts by default", async () => {
    const connection = createDb(DATABASE_URL!);
    try {
      const statement = await connection.pool.query<{ statement_timeout: string }>("SHOW statement_timeout");
      const idle = await connection.pool.query<{ idle_in_transaction_session_timeout: string }>(
        "SHOW idle_in_transaction_session_timeout"
      );
      expect(statement.rows[0]?.statement_timeout).toBe("30s");
      expect(idle.rows[0]?.idle_in_transaction_session_timeout).toBe("30s");
    } finally {
      await connection.close();
    }
  });

  it("applies configured session timeouts", async () => {
    const connection = createDb(DATABASE_URL!, {
      statementTimeoutMs: 1_234,
      idleInTransactionSessionTimeoutMs: 4_321
    });
    try {
      const statement = await connection.pool.query<{ statement_timeout: string }>("SHOW statement_timeout");
      const idle = await connection.pool.query<{ idle_in_transaction_session_timeout: string }>(
        "SHOW idle_in_transaction_session_timeout"
      );
      expect(statement.rows[0]?.statement_timeout).toBe("1234ms");
      expect(idle.rows[0]?.idle_in_transaction_session_timeout).toBe("4321ms");
    } finally {
      await connection.close();
    }
  });

  it("cancels a statement that runs past statement_timeout", async () => {
    const connection = createDb(DATABASE_URL!, { statementTimeoutMs: 100 });
    try {
      await expect(connection.pool.query("SELECT pg_sleep(2)")).rejects.toMatchObject({ code: "57014" });
    } finally {
      await connection.close();
    }
  });

  it("fails a pool checkout after connectionTimeoutMillis instead of waiting forever when the pool is exhausted", async () => {
    const connection = createDb(DATABASE_URL!, { max: 1, connectionTimeoutMillis: 300 });
    const held = await connection.pool.connect();
    try {
      const startedAt = Date.now();
      await expect(connection.pool.connect()).rejects.toThrow(/timeout/i);
      const waitedMs = Date.now() - startedAt;
      expect(waitedMs).toBeGreaterThanOrEqual(250);
      expect(waitedMs).toBeLessThan(5_000);
    } finally {
      held.release();
      await connection.close();
    }
  });
});
