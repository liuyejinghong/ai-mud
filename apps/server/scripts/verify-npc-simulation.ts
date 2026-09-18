import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_ITEMS } from "@ai-mud/content";
import pg from "pg";
import { createDb } from "../src/db/client.js";
import { GameRepository } from "../src/modules/game/game.repository.js";
import { LedgerRepository } from "../src/modules/ledger/ledger.repository.js";
import { LedgerService } from "../src/modules/ledger/ledger.service.js";
import { NpcRepository } from "../src/modules/npc/npc.repository.js";
import { NpcService } from "../src/modules/npc/npc.service.js";
import { runNpcSimulationOnSnapshot } from "../src/modules/npc/npc.simulation-repository.js";

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const { Client } = pg;
const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");
const settlementId = "blackpine_outpost" as const;

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function splitMigration(sql: string) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigrations(client: pg.Client) {
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const entries = journal.entries.slice().sort((left, right) => left.idx - right.idx);

  for (const entry of entries) {
    const sql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
    for (const statement of splitMigration(sql)) await client.query(statement);
  }
}

async function dropDatabase(admin: pg.Client, databaseName: string) {
  const identifier = quoteIdentifier(databaseName);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`);
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
    await admin.query(`DROP DATABASE IF EXISTS ${identifier}`);
  }
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function seedMarket(repository: GameRepository) {
  for (const item of FIRST_ITEMS) {
    await repository.upsertMarketInventory({
      settlementId,
      itemId: item.id,
      quantity: Math.floor(item.targetMarketQuantity / 2),
      targetQuantity: item.targetMarketQuantity,
      baseBuyPriceCopper: item.baseBuyPriceCopper,
      baseSellPriceCopper: item.baseSellPriceCopper
    });
  }
}

async function verifySimulation(targetDatabaseUrl: string) {
  const connection = createDb(targetDatabaseUrl);
  const ledger = new LedgerService(new LedgerRepository(connection.db));
  const npcService = new NpcService(new NpcRepository(connection.db), ledger);
  const startAt = new Date("2026-07-01T06:37:20.000Z");

  try {
    await npcService.ensureWorldSeeded(startAt);
    await seedMarket(new GameRepository(connection.db));

    const ledgerBefore = await ledger.getHealth(startAt);
    const report = await runNpcSimulationOnSnapshot(new NpcRepository(connection.db), 7, startAt);
    const ledgerAfter = await ledger.getHealth(new Date(report.endedAt));

    assertCondition(
      report.health.ok,
      `NPC simulation health failed: ${report.health.issues.join(", ")}`
    );
    assertCondition(
      report.metrics.idleRate < 0.3,
      `NPC idle rate ${report.metrics.idleRate} is not below 0.30.`
    );
    assertCondition(
      report.metrics.starvingNpcCount === 0,
      "NPC simulation ended with starving NPCs."
    );
    assertCondition(
      report.metrics.marketTransactionsPerDay > 0,
      "NPC simulation produced no market transactions."
    );
    assertCondition(
      report.metrics.taskTriggerRate > 0,
      "NPC simulation produced no completed work."
    );
    assertCondition(ledgerBefore.status === "ok", "Ledger was already drifting before simulation.");
    assertCondition(ledgerAfter.status === "ok", "Read-only simulation changed ledger health.");
    assertCondition(
      ledgerAfter.totalDrift.totalCopper === 0,
      `Ledger drift after simulation is ${ledgerAfter.totalDrift.totalCopper} copper.`
    );

    console.log(
      JSON.stringify(
        {
          days: report.days,
          health: report.health,
          idleRate: report.metrics.idleRate,
          starvingNpcCount: report.metrics.starvingNpcCount,
          marketTransactionsPerDay: report.metrics.marketTransactionsPerDay,
          taskTriggerRate: report.metrics.taskTriggerRate,
          resourceStartCharges: report.metrics.resourceStartCharges,
          resourceEndCharges: report.metrics.resourceEndCharges,
          ledgerBefore: ledgerBefore.status,
          ledgerAfter: ledgerAfter.status,
          ledgerDriftCopper: ledgerAfter.totalDrift.totalCopper
        },
        null,
        2
      )
    );
  } finally {
    await connection.close();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to verify NPC simulation.");

  const databaseName = `ai_mud_npc_sim_verify_${Date.now()}_${process.pid}`;
  const admin = new Client({ connectionString: databaseUrl });
  let target: pg.Client | null = null;
  await admin.connect();

  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    const targetDatabaseUrl = databaseUrlForName(databaseUrl, databaseName);
    target = new Client({ connectionString: targetDatabaseUrl });
    await target.connect();
    await applyMigrations(target);
    await target.end();
    target = null;

    await verifySimulation(targetDatabaseUrl);
  } finally {
    if (target) await target.end();
    await dropDatabase(admin, databaseName);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
