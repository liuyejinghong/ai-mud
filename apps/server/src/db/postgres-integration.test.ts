import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

interface RequiredColumn {
  tableName: string;
  columnName: string;
}

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(testFile)));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

const requiredColumns: RequiredColumn[] = [
  { tableName: "npc_tasks", columnName: "proposal_source" },
  { tableName: "npc_tasks", columnName: "proposal_reason" },
  { tableName: "world_resource_nodes", columnName: "last_refreshed_at" },
  { tableName: "map_instances", columnName: "resources_refreshed_at" }
];

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function makeTempDatabaseName() {
  return `ai_mud_vitest_migrations_${Date.now()}_${process.pid}`;
}

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function readJournal() {
  const raw = await readFile(journalPath, "utf8");
  return JSON.parse(raw) as Journal;
}

async function listSqlTags() {
  return (await readdir(drizzleDir))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .map((file) => file.replace(/\.sql$/, ""))
    .sort();
}

function splitMigration(sql: string) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigrations(client: pg.Client, journal: Journal) {
  const entries = journal.entries.slice().sort((left, right) => left.idx - right.idx);

  for (const entry of entries) {
    const filePath = join(drizzleDir, `${entry.tag}.sql`);
    const sql = await readFile(filePath, "utf8");

    for (const statement of splitMigration(sql)) {
      await client.query(statement);
    }
  }
}

async function assertRequiredColumns(client: pg.Client) {
  for (const column of requiredColumns) {
    const result = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = $2
        ) AS "exists"
      `,
      [column.tableName, column.columnName]
    );

    expect(result.rows[0]?.exists, `${column.tableName}.${column.columnName}`).toBe(true);
  }
}

async function dropDatabase(admin: pg.Client, databaseName: string) {
  const databaseIdentifier = quoteIdentifier(databaseName);

  try {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseIdentifier} WITH (FORCE)`);
  } catch {
    await admin.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [databaseName]
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseIdentifier}`);
  }
}

describe("postgres integration migrations", () => {
  it("applies the full migration chain to an empty PostgreSQL database", async (context) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.warn("DATABASE_URL is not set; skipping PostgreSQL integration migration test.");
      context.skip();
      return;
    }

    const journal = await readJournal();
    const journalTags = journal.entries
      .slice()
      .sort((left, right) => left.idx - right.idx)
      .map((entry) => entry.tag);

    expect(journalTags).toEqual(await listSqlTags());

    const tempDatabase = makeTempDatabaseName();
    const admin = new Client({ connectionString: databaseUrl });
    let target: pg.Client | null = null;

    await admin.connect();

    try {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(tempDatabase)}`);
      target = new Client({ connectionString: databaseUrlForName(databaseUrl, tempDatabase) });
      await target.connect();
      await applyMigrations(target, journal);
      await assertRequiredColumns(target);
    } finally {
      if (target) await target.end();
      await dropDatabase(admin, tempDatabase);
      await admin.end();
    }
  });
});
