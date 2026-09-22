import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv } from "../config/env.js";
import * as schema from "./schema.js";

export function createDb(databaseUrl = loadEnv().DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
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
