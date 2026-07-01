import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv } from "../config/env.js";
import * as schema from "./schema.js";

export function createDb(databaseUrl = loadEnv().DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
