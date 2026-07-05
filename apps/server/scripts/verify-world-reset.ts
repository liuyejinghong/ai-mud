import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDb } from "../src/db/client.js";
import { aiCallLogs, characters, municipalTreasury, worldActors, worldResourceNodes } from "../src/db/schema.js";
import { DrizzleAuditWriter } from "../src/modules/audit/audit.repository.js";
import { AuthRepository } from "../src/modules/auth/auth.repository.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { GameService } from "../src/modules/game/game.service.js";
import { NpcRepository } from "../src/modules/npc/npc.repository.js";
import { NpcService } from "../src/modules/npc/npc.service.js";
import { WorldResetRepository } from "../src/modules/world-reset/world-reset.repository.js";
import {
  WORLD_RESET_CONFIRMATION_TEXT,
  WorldResetService
} from "../src/modules/world-reset/world-reset.service.js";

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const { Client } = pg;
const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function makeTempDatabaseName() {
  return `ai_mud_world_reset_verify_${Date.now()}_${process.pid}`;
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

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verifyResetFlow(targetDatabaseUrl: string) {
  const connection = createDb(targetDatabaseUrl);
  const { db } = connection;
  const auth = new AuthService();
  const authRepo = new AuthRepository(db);
  const game = new GameService(db);
  const npcService = new NpcService(new NpcRepository(db));
  const now = new Date("2026-07-05T12:00:00.000Z");

  try {
    await npcService.ensureWorldSeeded(now);

    const oldAccount = await authRepo.createAccount({
      email: "old-reset-player@example.com",
      passwordHash: await auth.hashPassword("old-password")
    });
    const oldState = await game.createCharacter(oldAccount.id, {
      name: "OldResetter",
      classId: "warrior"
    });
    const [oldNpc] = await db.select().from(worldActors).limit(1);
    assertCondition(oldNpc, "Expected seeded NPC before reset.");

    await db.insert(aiCallLogs).values({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: 1,
      purpose: "npc_dialogue",
      accountId: oldAccount.id,
      characterId: oldState.character.id,
      npcActorId: oldNpc.id,
      requestHash: "world-reset-verify",
      inputSummary: "reset verify input",
      outputSummary: "reset verify output",
      status: "success"
    });

    await db.transaction(async (tx) => {
      const service = new WorldResetService({
        repository: new WorldResetRepository(tx),
        audit: new DrizzleAuditWriter(tx),
        now: () => now
      });
      await service.resetWorld({
        actorAccountId: oldAccount.id,
        confirmationText: WORLD_RESET_CONFIRMATION_TEXT,
        reason: "验证真实世界重置流程"
      });
    });

    const charactersAfterReset = await db.select().from(characters);
    assertCondition(charactersAfterReset.length === 0, "Expected reset to clear old characters.");

    const aiLogsAfterReset = await db.select().from(aiCallLogs);
    assertCondition(aiLogsAfterReset.length === 1, "Expected reset to preserve AI call logs.");
    assertCondition(
      aiLogsAfterReset[0]?.characterId === null && aiLogsAfterReset[0]?.npcActorId === null,
      "Expected preserved AI call log to detach old character/NPC references."
    );

    const npcsAfterReset = await db.select().from(worldActors);
    const resourcesAfterReset = await db.select().from(worldResourceNodes);
    const treasuryAfterReset = await db.select().from(municipalTreasury);
    assertCondition(npcsAfterReset.length > 0, "Expected reset to seed NPC actors.");
    assertCondition(resourcesAfterReset.length > 0, "Expected reset to seed shared resources.");
    assertCondition(treasuryAfterReset.length > 0, "Expected reset to seed municipal treasury.");

    const newAccount = await authRepo.createAccount({
      email: "new-reset-player@example.com",
      passwordHash: await auth.hashPassword("new-password")
    });
    const newState = await game.createCharacter(newAccount.id, {
      name: "NewResetter",
      classId: "ranger"
    });
    assertCondition(
      newState.character.name === "NewResetter",
      "Expected new account to create and enter with a character after reset."
    );
  } finally {
    await connection.close();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to verify world reset.");
  }

  const journal = await readJournal();
  await assertJournalMatchesSqlFiles(journal);

  const tempDatabase = makeTempDatabaseName();
  const admin = new Client({ connectionString: databaseUrl });
  let target: pg.Client | null = null;

  await admin.connect();

  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(tempDatabase)}`);
    const targetDatabaseUrl = databaseUrlForName(databaseUrl, tempDatabase);
    target = new Client({ connectionString: targetDatabaseUrl });
    await target.connect();
    await applyMigrations(target, journal);
    await target.end();
    target = null;

    await verifyResetFlow(targetDatabaseUrl);
    console.log(`World reset verification passed in temporary database ${tempDatabase}.`);
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
