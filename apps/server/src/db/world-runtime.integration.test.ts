import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { GameRepository } from "../modules/game/game.repository.js";
import { LedgerRepository } from "../modules/ledger/ledger.repository.js";
import { LedgerService } from "../modules/ledger/ledger.service.js";
import { NpcRepository } from "../modules/npc/npc.repository.js";
import { NpcService } from "../modules/npc/npc.service.js";
import { systemWorldClock } from "../modules/world-runtime/world-clock.js";
import { WorldRuntimeRepository } from "../modules/world-runtime/world-runtime.repository.js";
import {
  NPC_WORLD_RUNTIME_KEY,
  WorldRuntimeService,
  type WorldRuntimeSettleResult
} from "../modules/world-runtime/world-runtime.service.js";
import { createDb, type Db } from "./client.js";

// Real-PostgreSQL proof for the ARCH-02 tick mutex (G01): two concurrent
// callers race the same tick, exactly one settlement lands; a fault-injected
// rollback keeps the tick for the next caller; progress never regresses;
// batch catch-up equals sequential settlement. No lease sleeps — the lock is
// the runtime row FOR UPDATE inside the tick transaction.

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(testFile)));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

const T0 = new Date("2026-07-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const tickAt = (minute: number) => new Date(T0.getTime() + minute * MINUTE_MS);

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL not set; skipping world-runtime PG concurrency tests");
    return null;
  }
  return url;
}

function makeTempDatabaseName() {
  return `ai_mud_vitest_worldtick_${process.pid}_${randomUUID().replace(/-/g, "")}`;
}

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createTempDatabaseFromMigrations(baseDatabaseUrl: string) {
  const databaseName = makeTempDatabaseName();
  const adminClient = new Client({ connectionString: databaseUrlForName(baseDatabaseUrl, "postgres") });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${JSON.stringify(databaseName)}`);
  await adminClient.end();

  const targetUrl = databaseUrlForName(baseDatabaseUrl, databaseName);
  const client = new Client({ connectionString: targetUrl });
  await client.connect();

  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  for (const entry of journal.entries) {
    const sql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await client.query(statement);
    }
  }
  return { databaseName, targetUrl, client };
}

interface Harness {
  client: pg.Client;
  makeDb: () => Db;
  dispose: () => Promise<void>;
}

async function createHarness(databaseUrl: string): Promise<Harness> {
  const { databaseName, targetUrl, client } = await createTempDatabaseFromMigrations(databaseUrl);
  const closers: Array<() => Promise<void>> = [];
  return {
    client,
    makeDb: () => {
      const created = createDb(targetUrl);
      closers.push(created.close);
      return created.db;
    },
    dispose: async () => {
      for (const close of closers) await close();
      await client.end();
      const adminClient = new Client({ connectionString: databaseUrlForName(databaseUrl, "postgres") });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE ${JSON.stringify(databaseName)} WITH (FORCE)`);
      await adminClient.end();
    }
  };
}

interface TickCounter {
  failTicks: Set<number>;
}

function createWorldRuntime(db: Db, client: pg.Client, counter: TickCounter): WorldRuntimeService {
  return new WorldRuntimeService({
    repo: new WorldRuntimeRepository(db),
    clock: systemWorldClock,
    participants: [
      async (_tx, tick) => {
        const minute = Math.round((tick.getTime() - T0.getTime()) / MINUTE_MS);
        if (counter.failTicks.has(minute)) throw new Error(`injected failure at tick ${minute}`);
        await client.query(
          `INSERT INTO tick_counts (tick_at, n) VALUES ($1, 1)
           ON CONFLICT (tick_at) DO UPDATE SET n = tick_counts.n + 1`,
          [tick.toISOString()]
        );
      }
    ]
  });
}

describe("world runtime PostgreSQL tick mutex", () => {
  it("settles a contended tick exactly once", async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const harness = await createHarness(databaseUrl);
    try {
      await harness.client.query("CREATE TABLE tick_counts (tick_at timestamptz primary key, n int not null)");
      await new WorldRuntimeRepository(harness.makeDb()).ensureRow(NPC_WORLD_RUNTIME_KEY, T0);
      const counter: TickCounter = { failTicks: new Set() };

      // Two "processes" race the same due tick on separate connections.
      const [a, b] = await Promise.all([
        createWorldRuntime(harness.makeDb(), harness.client, counter).settleDue(tickAt(1)),
        createWorldRuntime(harness.makeDb(), harness.client, counter).settleDue(tickAt(1))
      ]);

      const settledSteps = [a, b]
        .filter((r: WorldRuntimeSettleResult) => !r.skipped)
        .reduce((sum, r) => sum + r.settledSteps, 0);
      expect(settledSteps).toBe(1);
      const { rows } = await harness.client.query("SELECT tick_at, n FROM tick_counts");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ n: 1 });
      const progress = await new WorldRuntimeRepository(harness.makeDb()).find(NPC_WORLD_RUNTIME_KEY);
      expect(progress?.lastSettledAt?.toISOString()).toBe(tickAt(1).toISOString());
    } finally {
      await harness.dispose();
    }
  }, 60_000);

  it("keeps the tick after a fault-injected rollback, so the next caller settles it once", async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const harness = await createHarness(databaseUrl);
    try {
      await harness.client.query("CREATE TABLE tick_counts (tick_at timestamptz primary key, n int not null)");
      await new WorldRuntimeRepository(harness.makeDb()).ensureRow(NPC_WORLD_RUNTIME_KEY, T0);
      const counter: TickCounter = { failTicks: new Set([1]) };

      await expect(
        createWorldRuntime(harness.makeDb(), harness.client, counter).settleDue(tickAt(1))
      ).rejects.toThrow("injected failure at tick 1");
      let progress = await new WorldRuntimeRepository(harness.makeDb()).find(NPC_WORLD_RUNTIME_KEY);
      expect(progress?.lastSettledAt?.toISOString()).toBe(T0.toISOString());

      // Lift the injected fault: the tick must still be there for the next caller.
      counter.failTicks.delete(1);
      const second = await createWorldRuntime(harness.makeDb(), harness.client, counter).settleDue(tickAt(1));
      expect(second).toEqual({ settledSteps: 1, skipped: false });
      progress = await new WorldRuntimeRepository(harness.makeDb()).find(NPC_WORLD_RUNTIME_KEY);
      expect(progress?.lastSettledAt?.toISOString()).toBe(tickAt(1).toISOString());
      const { rows } = await harness.client.query("SELECT n FROM tick_counts WHERE tick_at = $1", [tickAt(1)]);
      expect(rows).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  }, 60_000);

  it("never regresses progress or double-settles past ticks", async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const harness = await createHarness(databaseUrl);
    try {
      await harness.client.query("CREATE TABLE tick_counts (tick_at timestamptz primary key, n int not null)");
      const db = harness.makeDb();
      await new WorldRuntimeRepository(db).ensureRow(NPC_WORLD_RUNTIME_KEY, T0);
      const counter: TickCounter = { failTicks: new Set() };

      await createWorldRuntime(db, harness.client, counter).settleDue(tickAt(2));
      // Re-running an older wall clock structurally cannot settle past ticks:
      // progress is re-read under the row lock on every attempt.
      const rerun = await createWorldRuntime(db, harness.client, counter).settleDue(tickAt(1));
      expect(rerun).toEqual({ settledSteps: 0, skipped: true });

      const { rows } = await harness.client.query("SELECT tick_at, n FROM tick_counts ORDER BY tick_at");
      expect(rows).toHaveLength(2);
      expect(rows.every((row: { n: number }) => row.n === 1)).toBe(true);
      expect(
        (await new WorldRuntimeRepository(harness.makeDb()).find(NPC_WORLD_RUNTIME_KEY))?.lastSettledAt?.toISOString()
      ).toBe(tickAt(2).toISOString());
    } finally {
      await harness.dispose();
    }
  }, 60_000);

  it("reaches the same world state from one catch-up batch or sequential settlement", async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const buildWorld = async (harness: Harness) => {
      const db = harness.makeDb();
      const npc = new NpcService(new NpcRepository(db), new LedgerService(new LedgerRepository(db)));
      await npc.ensureWorldSeeded(T0);
      await npc.settleNpcWorld(T0);
      await new WorldRuntimeRepository(db).ensureRow(NPC_WORLD_RUNTIME_KEY, T0);
      const runtime = new WorldRuntimeService({
        repo: new WorldRuntimeRepository(db),
        clock: systemWorldClock,
        participants: [
          async (tx, tick) => {
            await new NpcService(new NpcRepository(tx), new LedgerService(new LedgerRepository(tx))).settleNpcWorld(tick);
          },
          async (tx, tick) => {
            await new GameRepository(tx).refreshDueInstanceResources({ now: tick });
          }
        ]
      });
      return { db, runtime };
    };

    const batch = await createHarness(databaseUrl);
    const sequential = await createHarness(databaseUrl);
    try {
      const a = await buildWorld(batch);
      const b = await buildWorld(sequential);

      await a.runtime.settleDue(tickAt(3));
      for (const minute of [1, 2, 3]) {
        await b.runtime.settleDue(tickAt(minute));
      }

      const snapshot = async (db: Db) => {
        const npcRepo = new NpcRepository(db);
        const [actors, actions, transactions] = await Promise.all([
          npcRepo.listNpcActors(),
          npcRepo.listNpcActions(),
          npcRepo.countNpcMarketTransactions()
        ]);
        return {
          copper: actors.reduce((sum, actor) => sum + actor.copperBalance, 0),
          hunger: actors.map((actor) => actor.hunger).sort((x, y) => x - y).join(","),
          actionCount: actions.length,
          completedActionCount: actions.filter((action) => action.status === "completed").length,
          transactions
        };
      };
      expect(await snapshot(b.db)).toEqual(await snapshot(a.db));
    } finally {
      await batch.dispose();
      await sequential.dispose();
    }
  }, 60_000);

  it("refreshes personal instance resources through the character-side participant exactly once", async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const harness = await createHarness(databaseUrl);
    try {
      const db = harness.makeDb();
      const npc = new NpcService(new NpcRepository(db), new LedgerService(new LedgerRepository(db)));
      await npc.ensureWorldSeeded(T0);
      await npc.settleNpcWorld(T0);
      await new WorldRuntimeRepository(db).ensureRow(NPC_WORLD_RUNTIME_KEY, T0);

      // A character with a personal instance whose resources ran out 2 days ago.
      const account = await harness.client.query(
        `INSERT INTO accounts (email, password_hash, role) VALUES ('tick@it.test', 'x', 'player') RETURNING id`
      );
      const character = await harness.client.query(
        `INSERT INTO characters (account_id, name, class_id, hp, max_hp, copper_balance)
         VALUES ($1, 'Ticker', 'warrior', 20, 20, 0) RETURNING id`,
        [account.rows[0].id]
      );
      const gameRepo = new GameRepository(db);
      await gameRepo.createMapInstance({
        characterId: character.rows[0].id,
        zoneId: "old_mine",
        resourceCharges: { old_mine_iron_vein_01: 0, old_mine_coppery_iron_vein_01: 0 }
      });
      await harness.client.query(
        "UPDATE map_instances SET resources_refreshed_at = $1",
        [new Date(T0.getTime() - 2 * 24 * 60 * 60_000).toISOString()]
      );

      const runtime = new WorldRuntimeService({
        repo: new WorldRuntimeRepository(db),
        clock: systemWorldClock,
        participants: [
          async (tx, tick) => {
            await new NpcService(new NpcRepository(tx), new LedgerService(new LedgerRepository(tx))).settleNpcWorld(tick);
          },
          async (tx, tick) => {
            await new GameRepository(tx).refreshDueInstanceResources({ now: tick });
          }
        ]
      });
      const result = await runtime.settleDue(tickAt(1));
      expect(result).toEqual({ settledSteps: 1, skipped: false });

      const { rows } = await harness.client.query(
        "SELECT resource_charges, resources_refreshed_at FROM map_instances LIMIT 1"
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].resource_charges).toMatchObject({
        old_mine_iron_vein_01: 80,
        old_mine_coppery_iron_vein_01: 50
      });
      expect(new Date(rows[0].resources_refreshed_at).toISOString()).toBe(tickAt(1).toISOString());
    } finally {
      await harness.dispose();
    }
  }, 60_000);
});
