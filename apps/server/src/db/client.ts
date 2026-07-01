import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv } from "../config/env.js";
import * as schema from "./schema.js";

export function createDb(databaseUrl = loadEnv().DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end()
  };
}

export type DbConnection = ReturnType<typeof createDb>;
export type Db = DbConnection["db"];
