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
  { tableName: "map_instances", columnName: "resources_refreshed_at" },
  { tableName: "item_instances", columnName: "owner_type" },
  { tableName: "item_ledger", columnName: "operation" },
  { tableName: "sync_events", columnName: "state_dirty" },
  { tableName: "chat_messages", columnName: "body" },
  { tableName: "character_presence", columnName: "last_seen_at" }
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

async function applyMigrationEntries(client: pg.Client, entries: Journal["entries"]) {

  for (const entry of entries) {
    const filePath = join(drizzleDir, `${entry.tag}.sql`);
    const sql = await readFile(filePath, "utf8");

    for (const statement of splitMigration(sql)) {
      await client.query(statement);
    }
  }
}

async function seedDuplicateWorldRumors(client: pg.Client) {
  await client.query(`
    INSERT INTO world_rumors (id, source_type, source_id, message, generated_by, created_at)
    VALUES
      ('00000000-0000-0000-0000-000000000002', 'npc_event', '10000000-0000-0000-0000-000000000001', 'later id', 'template', '2026-07-02T10:00:00Z'),
      ('00000000-0000-0000-0000-000000000001', 'npc_event', '10000000-0000-0000-0000-000000000001', 'keeper', 'template', '2026-07-02T10:00:00Z'),
      ('00000000-0000-0000-0000-000000000003', 'npc_event', '10000000-0000-0000-0000-000000000001', 'later time', 'template', '2026-07-02T11:00:00Z')
  `);
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

async function assertAssetGuards(client: pg.Client) {
  const requiredChecks = [
    "characters_copper_balance_nonnegative_check",
    "world_actors_copper_balance_nonnegative_check",
    "municipal_treasury_copper_balance_nonnegative_check",
    "market_inventory_quantity_nonnegative_check",
    "character_items_quantity_nonnegative_check",
    "npc_items_quantity_nonnegative_check",
    "world_resource_nodes_charges_nonnegative_check",
    "map_instances_resource_charges_nonnegative_check"
  ];
  const checks = await client.query<{ conname: string }>(
    `
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'c'
        AND conname = ANY($1::text[])
    `,
    [requiredChecks]
  );
  expect(checks.rows.map((row) => row.conname).sort()).toEqual(requiredChecks.sort());

  const activeIndex = await client.query<{ indexdef: string }>(
    `
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'character_actions_one_active_per_character_idx'
    `
  );
  expect(activeIndex.rows).toHaveLength(1);
  expect(activeIndex.rows[0]?.indexdef).toContain("UNIQUE INDEX");
  expect(activeIndex.rows[0]?.indexdef).toContain("WHERE (status = 'active'");
}

async function assertWorldRumorSourceUniqueness(client: pg.Client) {
  const sourceIndex = await client.query<{ indexdef: string }>(`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'world_rumors_source_unique'
  `);
  expect(sourceIndex.rows).toHaveLength(1);
  expect(sourceIndex.rows[0]?.indexdef).toContain("UNIQUE INDEX");
  expect(sourceIndex.rows[0]?.indexdef).toContain("WHERE (source_id IS NOT NULL)");

  const deduplicated = await client.query<{ id: string }>(`
    SELECT id
    FROM world_rumors
    WHERE source_type = 'npc_event'
      AND source_id = '10000000-0000-0000-0000-000000000001'
  `);
  expect(deduplicated.rows).toEqual([{ id: "00000000-0000-0000-0000-000000000001" }]);

  await expect(
    client.query(`
      INSERT INTO world_rumors (source_type, source_id, message, generated_by)
      VALUES ('npc_event', '10000000-0000-0000-0000-000000000001', 'duplicate', 'template')
    `)
  ).rejects.toMatchObject({ code: "23505" });

  await client.query(`
    INSERT INTO world_rumors (source_type, source_id, message, generated_by)
    VALUES
      ('manual', NULL, 'first source-free rumor', 'template'),
      ('manual', NULL, 'second source-free rumor', 'template')
  `);
  const sourceFree = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM world_rumors
    WHERE source_type = 'manual' AND source_id IS NULL
  `);
  expect(sourceFree.rows[0]?.count).toBe("2");
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
      const entries = journal.entries.slice().sort((left, right) => left.idx - right.idx);
      await applyMigrationEntries(target, entries.filter((entry) => entry.idx < 22));
      await seedDuplicateWorldRumors(target);
      await applyMigrationEntries(target, entries.filter((entry) => entry.idx >= 22));
      await assertRequiredColumns(target);
      await assertAssetGuards(target);
      await assertWorldRumorSourceUniqueness(target);
    } finally {
      if (target) await target.end();
      await dropDatabase(admin, tempDatabase);
      await admin.end();
    }
  });
});
