import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv, type Env } from "../config/env.js";
import * as schema from "./schema.js";

export interface DbPoolOptions {
  max: number;
  // 从池取连接的最长等待；pg 缺省 0 = 无限等待。
  connectionTimeoutMillis: number;
  // 每个会话的 statement_timeout（含等锁时间）。
  statementTimeoutMs: number;
  // 每个会话的 idle_in_transaction_session_timeout：事务开着却不发语句的上限。
  idleInTransactionSessionTimeoutMs: number;
}

export type DbPoolOptionsInput = { [Key in keyof DbPoolOptions]?: DbPoolOptions[Key] | undefined };

// 车道 C5（评审 ARCH-domain-08）：pg.Pool 缺省配置下取连接无限等待、库侧也不限语句/空闲事务时长，
// 任何“事务里再向池借连接”的路径都能把整池永久挂死（/health 仍返回 ok，只能重启）。
// 这里给有限默认值：挂死变成可恢复的报错。env（DB_*）可覆盖。
// Directive: 不要把任何一项改回 0 或删掉——0 在 pg/PostgreSQL 里都表示“不限”。
export const DEFAULT_DB_POOL_OPTIONS: DbPoolOptions = {
  max: 10,
  connectionTimeoutMillis: 10_000,
  statementTimeoutMs: 30_000,
  idleInTransactionSessionTimeoutMs: 30_000
};

export function dbPoolOptionsFromEnv(
  env: Partial<
    Pick<
      Env,
      | "DB_POOL_MAX"
      | "DB_POOL_CONNECTION_TIMEOUT_MS"
      | "DB_STATEMENT_TIMEOUT_MS"
      | "DB_IDLE_IN_TRANSACTION_TIMEOUT_MS"
    >
  >
): DbPoolOptionsInput {
  return {
    max: env.DB_POOL_MAX,
    connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    idleInTransactionSessionTimeoutMs: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS
  };
}

export function createDb(databaseUrl = loadEnv().DATABASE_URL, options: DbPoolOptionsInput = {}) {
  const resolved: DbPoolOptions = {
    max: options.max ?? DEFAULT_DB_POOL_OPTIONS.max,
    connectionTimeoutMillis:
      options.connectionTimeoutMillis ?? DEFAULT_DB_POOL_OPTIONS.connectionTimeoutMillis,
    statementTimeoutMs: options.statementTimeoutMs ?? DEFAULT_DB_POOL_OPTIONS.statementTimeoutMs,
    idleInTransactionSessionTimeoutMs:
      options.idleInTransactionSessionTimeoutMs ??
      DEFAULT_DB_POOL_OPTIONS.idleInTransactionSessionTimeoutMs
  };
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: resolved.max,
    connectionTimeoutMillis: resolved.connectionTimeoutMillis,
    // 作为连接启动参数下发：池里每个会话都带上，不依赖调用方 SET。
    statement_timeout: resolved.statementTimeoutMs,
    idle_in_transaction_session_timeout: resolved.idleInTransactionSessionTimeoutMs
  });
  // 空闲连接后台错误（如连接被管理员终止）必须被接住：未处理的 client 'error' 事件
  // 会击穿 Node 进程（2026-09-22 事故处置期间两次实测）。
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end()
  };
}

export type DbConnection = ReturnType<typeof createDb>;
export type Db = DbConnection["db"];
