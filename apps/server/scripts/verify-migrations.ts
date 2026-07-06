import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const { Client } = pg;
const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");
const requiredColumns = ["proposal_source", "proposal_reason"];
const requiredLedgerColumns = [
  "asset_type",
  "operation",
  "from_bucket",
  "to_bucket",
  "amount_copper",
  "reason"
];

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function makeTempDatabaseName() {
  return `ai_mud_migration_verify_${Date.now()}_${process.pid}`;
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

async function assertJournalMatchesSqlFiles(journal: Journal) {
  const sqlTags = (await readdir(drizzleDir))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .map((file) => file.replace(/\.sql$/, ""))
    .sort();
  const journalTags = journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) => entry.tag);

  if (JSON.stringify(sqlTags) !== JSON.stringify(journalTags)) {
    throw new Error(
      `Migration journal mismatch.\nSQL files: ${sqlTags.join(", ")}\nJournal: ${journalTags.join(", ")}`
    );
  }
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

async function assertNpcTaskProposalColumns(client: pg.Client) {
  const result = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'npc_tasks'
        AND column_name = ANY($1)
      ORDER BY column_name
    `,
    [requiredColumns]
  );
  const actual = result.rows.map((row) => row.column_name);

  for (const column of requiredColumns) {
    if (!actual.includes(column)) {
      throw new Error(`Missing npc_tasks.${column} after applying migrations.`);
    }
  }
}

async function assertAssetLedgerColumns(client: pg.Client) {
  const result = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'asset_ledger'
        AND column_name = ANY($1)
      ORDER BY column_name
    `,
    [requiredLedgerColumns]
  );
  const actual = result.rows.map((row) => row.column_name);

  for (const column of requiredLedgerColumns) {
    if (!actual.includes(column)) {
      throw new Error(`Missing asset_ledger.${column} after applying migrations.`);
    }
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

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to verify migrations.");
  }

  const journal = await readJournal();
  await assertJournalMatchesSqlFiles(journal);

  const tempDatabase = makeTempDatabaseName();
  const admin = new Client({ connectionString: databaseUrl });
  let target: pg.Client | null = null;

  await admin.connect();

  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(tempDatabase)}`);
    target = new Client({ connectionString: databaseUrlForName(databaseUrl, tempDatabase) });
    await target.connect();
    await applyMigrations(target, journal);
    await assertNpcTaskProposalColumns(target);
    await assertAssetLedgerColumns(target);
    console.log(`Migration verification passed in temporary database ${tempDatabase}.`);
  } finally {
    if (target) await target.end();
    await dropDatabase(admin, tempDatabase);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
