import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_ITEMS } from "@ai-mud/content";
import { calculateMarketQuote } from "@ai-mud/game-rules";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createDb, type DbConnection } from "./client.js";
import { GameService, GameServiceError } from "../modules/game/game.service.js";

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

interface Harness {
  databaseUrl: string;
  client: pg.Client;
  firstConnection: DbConnection;
  secondConnection: DbConnection;
  firstService: GameService;
  secondService: GameService;
}

interface SeededCharacter {
  accountId: string;
  characterId: string;
}

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(testFile)));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function makeTempDatabaseName() {
  return `ai_mud_vitest_concurrency_${process.pid}_${randomUUID().replace(/-/g, "")}`;
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

async function applyMigrations(client: pg.Client) {
  const journal = await readJournal();
  const entries = journal.entries.slice().sort((left, right) => left.idx - right.idx);
  expect(entries.map((entry) => entry.tag)).toEqual(await listSqlTags());

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

async function withTempDatabase(
  databaseUrl: string,
  run: (harness: Harness) => Promise<void>
) {
  const databaseName = makeTempDatabaseName();
  const tempUrl = databaseUrlForName(databaseUrl, databaseName);
  const admin = new Client({ connectionString: databaseUrl });
  let migrationClient: pg.Client | null = null;
  let client: pg.Client | null = null;
  let firstConnection: DbConnection | null = null;
  let secondConnection: DbConnection | null = null;

  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    migrationClient = new Client({ connectionString: tempUrl });
    await migrationClient.connect();
    await applyMigrations(migrationClient);
    await migrationClient.end();
    migrationClient = null;

    client = new Client({ connectionString: tempUrl });
    await client.connect();
    firstConnection = createDb(tempUrl);
    secondConnection = createDb(tempUrl);
    firstConnection.pool.options.max = 1;
    secondConnection.pool.options.max = 1;

    await run({
      databaseUrl: tempUrl,
      client,
      firstConnection,
      secondConnection,
      firstService: new GameService(firstConnection.db),
      secondService: new GameService(secondConnection.db)
    });
  } finally {
    if (migrationClient) await migrationClient.end();
    if (firstConnection) await firstConnection.close();
    if (secondConnection) await secondConnection.close();
    if (client) await client.end();
    await dropDatabase(admin, databaseName);
    await admin.end();
  }
}

async function seedCharacter(
  client: pg.Client,
  input: {
    copperBalance: number;
    currentLocation?: "blackpine_outpost" | "corrupt_forest";
    position?: { x: number; y: number } | null;
  }
): Promise<SeededCharacter> {
  const accountId = randomUUID();
  const characterId = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, email, password_hash) VALUES ($1, $2, 'test')`,
    [accountId, `concurrency-${randomUUID()}@example.test`]
  );
  await client.query(
    `
      INSERT INTO characters (
        id, account_id, name, class_id, hp, max_hp, copper_balance,
        hunger, last_hunger_settled_at, current_location, position
      )
      VALUES ($1, $2, $3, 'ranger', 100, 100, $4, 5, NOW(), $5, $6::jsonb)
    `,
    [
      characterId,
      accountId,
      `Concurrent ${characterId.slice(0, 8)}`,
      input.copperBalance,
      input.currentLocation ?? "blackpine_outpost",
      input.position === undefined || input.position === null
        ? null
        : JSON.stringify(input.position)
    ]
  );
  return { accountId, characterId };
}

async function seedMarket(client: pg.Client, itemId: string, quantity: number) {
  for (const item of FIRST_ITEMS) {
    await client.query(
      `
        INSERT INTO market_inventory (
          settlement_id, item_id, quantity, target_quantity,
          base_buy_price_copper, base_sell_price_copper
        )
        VALUES ('blackpine_outpost', $1, $2, $3, $4, $5)
      `,
      [
        item.id,
        item.id === itemId ? quantity : Math.floor(item.targetMarketQuantity / 2),
        item.targetMarketQuantity,
        item.baseBuyPriceCopper,
        item.baseSellPriceCopper
      ]
    );
  }
  await client.query(
    `INSERT INTO municipal_treasury (settlement_id, copper_balance) VALUES ('blackpine_outpost', 0)`
  );
}

async function backendPid(connection: DbConnection) {
  const client = await connection.pool.connect();
  try {
    const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const pid = result.rows[0]?.pid;
    if (!pid) throw new Error("Failed to identify PostgreSQL backend");
    return pid;
  } finally {
    client.release();
  }
}

async function waitForLockWaiters(client: pg.Client, pids: number[]) {
  const deadline = Date.now() + 5_000;
  let lastRows: Array<{
    pid: number;
    state: string;
    wait_event_type: string | null;
    wait_event: string | null;
    query: string;
  }> = [];

  while (Date.now() < deadline) {
    const result = await client.query<{
      pid: number;
      state: string;
      wait_event_type: string | null;
      wait_event: string | null;
      query: string;
    }>(
      `
        SELECT pid, state, wait_event_type, wait_event, query
        FROM pg_stat_activity
        WHERE pid = ANY($1::int[])
      `,
      [pids]
    );
    lastRows = result.rows;
    if (
      pids.every((pid) =>
        result.rows.some((row) => row.pid === pid && row.wait_event_type === "Lock")
      )
    ) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  throw new Error(`Expected both PostgreSQL backends to wait on locks: ${JSON.stringify(lastRows)}`);
}

async function runBlockedPair<T>(
  harness: Harness,
  lockQuery: string,
  lockParams: unknown[],
  first: () => Promise<T>,
  second: () => Promise<T>
) {
  const firstPid = await backendPid(harness.firstConnection);
  const secondPid = await backendPid(harness.secondConnection);
  expect(firstPid).not.toBe(secondPid);

  const locker = new Client({ connectionString: harness.databaseUrl });
  await locker.connect();
  let lockReleased = false;
  let settled: Promise<PromiseSettledResult<T>[]> | null = null;
  try {
    await locker.query("BEGIN");
    await locker.query(lockQuery, lockParams);
    settled = Promise.allSettled([first(), second()]);
    await waitForLockWaiters(harness.client, [firstPid, secondPid]);
    await locker.query("COMMIT");
    lockReleased = true;
    return await settled;
  } finally {
    if (!lockReleased) await locker.query("ROLLBACK");
    if (settled) await settled;
    await locker.end();
  }
}

function expectOneValidationConflict<T>(results: PromiseSettledResult<T>[]) {
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  expect(rejected).toHaveLength(1);
  expect(rejected[0]?.reason).toBeInstanceOf(GameServiceError);
  expect(rejected[0]?.reason).toMatchObject({ code: "VALIDATION_ERROR" });
}

function requireDatabaseUrl(context: { skip: () => void }) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("DATABASE_URL is not set; skipping PostgreSQL game concurrency test.");
    context.skip();
    return null;
  }
  return databaseUrl;
}

describe("game PostgreSQL concurrency", () => {
  it(
    "settles one gathering cycle once across two overlapping getSync calls",
    async (context) => {
      const databaseUrl = requireDatabaseUrl(context);
      if (!databaseUrl) return;

      await withTempDatabase(databaseUrl, async (harness) => {
        const seeded = await seedCharacter(harness.client, {
          copperBalance: 0,
          currentLocation: "corrupt_forest",
          position: { x: 1, y: 3 }
        });
        const mapId = randomUUID();
        const actionId = randomUUID();
        await harness.client.query(
          `
            INSERT INTO map_instances (id, character_id, zone_id, resource_charges)
            VALUES ($1, $2, 'corrupt_forest', $3::jsonb)
          `,
          [mapId, seeded.characterId, JSON.stringify({ forest_berry_patch_01: 3 })]
        );
        await harness.client.query(
          `
            INSERT INTO character_actions (
              id, character_id, action_type, status, started_at, ends_at, payload
            )
            VALUES ($1, $2, 'gathering', 'active', NOW() - INTERVAL '31 seconds',
              NOW() + INTERVAL '5 minutes', $3::jsonb)
          `,
          [
            actionId,
            seeded.characterId,
            JSON.stringify({
              resourceId: "forest_berry_patch_01",
              itemId: "wild_berry",
              itemName: "野莓",
              quantityPerCycle: 2,
              cycleMs: 30_000,
              plannedCycles: 10,
              settledCycles: 0
            })
          ]
        );

        const results = await runBlockedPair(
          harness,
          "SELECT id FROM character_actions WHERE id = $1 FOR UPDATE",
          [actionId],
          () => harness.firstService.getSync(seeded.accountId),
          () => harness.secondService.getSync(seeded.accountId)
        );
        expect(results.every((result) => result.status === "fulfilled")).toBe(true);

        const inventory = await harness.client.query<{ quantity: number }>(
          `SELECT quantity FROM character_items WHERE character_id = $1 AND item_id = 'wild_berry'`,
          [seeded.characterId]
        );
        const map = await harness.client.query<{ charges: number }>(
          `SELECT (resource_charges ->> 'forest_berry_patch_01')::int AS charges FROM map_instances WHERE id = $1`,
          [mapId]
        );
        const action = await harness.client.query<{ settledCycles: number }>(
          `SELECT (payload ->> 'settledCycles')::int AS "settledCycles" FROM character_actions WHERE id = $1`,
          [actionId]
        );
        const events = await harness.client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM game_events WHERE character_id = $1 AND event_type = 'action.gathering.settle'`,
          [seeded.characterId]
        );
        const ledger = await harness.client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM item_ledger WHERE to_owner_id = $1 AND reason = 'action.gathering.settle'`,
          [seeded.characterId]
        );
        expect(inventory.rows[0]?.quantity).toBe(2);
        expect(map.rows[0]?.charges).toBe(2);
        expect(action.rows[0]?.settledCycles).toBe(1);
        expect(events.rows[0]?.count).toBe(1);
        expect(ledger.rows[0]?.count).toBe(1);
      });
    },
    30_000
  );

  it(
    "allows exactly one buyer to consume stock one",
    async (context) => {
      const databaseUrl = requireDatabaseUrl(context);
      if (!databaseUrl) return;

      await withTempDatabase(databaseUrl, async (harness) => {
        const seeded = await seedCharacter(harness.client, { copperBalance: 500 });
        await seedMarket(harness.client, "wild_berry", 1);
        const market = await harness.client.query<{ id: string }>(
          `SELECT id FROM market_inventory WHERE settlement_id = 'blackpine_outpost' AND item_id = 'wild_berry'`
        );
        const marketId = market.rows[0]?.id;
        expect(marketId).toBeTruthy();

        const results = await runBlockedPair(
          harness,
          "SELECT id FROM market_inventory WHERE id = $1 FOR UPDATE",
          [marketId],
          () => harness.firstService.buyMarketItem(seeded.accountId, { itemId: "wild_berry", quantity: 1 }),
          () => harness.secondService.buyMarketItem(seeded.accountId, { itemId: "wild_berry", quantity: 1 })
        );
        expectOneValidationConflict(results);

        const assets = await harness.client.query<{
          copperBalance: number;
          stock: number;
          itemQuantity: number;
          trades: number;
          ledgerEntries: number;
        }>(
          `
            SELECT
              c.copper_balance AS "copperBalance",
              m.quantity AS stock,
              COALESCE(ci.quantity, 0) AS "itemQuantity",
              (SELECT count(*)::int FROM market_transactions WHERE character_id = c.id) AS trades,
              (SELECT count(*)::int FROM asset_ledger WHERE operation = 'market_buy' AND from_entity_id = c.id::text) AS "ledgerEntries"
            FROM characters c
            JOIN market_inventory m ON m.id = $2
            LEFT JOIN character_items ci ON ci.character_id = c.id AND ci.item_id = 'wild_berry'
            WHERE c.id = $1
          `,
          [seeded.characterId, marketId]
        );
        expect(assets.rows[0]).toMatchObject({ stock: 0, itemQuantity: 1, trades: 1, ledgerEntries: 1 });
        expect(assets.rows[0]?.copperBalance).toBeGreaterThanOrEqual(0);
        expect(assets.rows[0]?.copperBalance).toBeLessThan(500);
      });
    },
    30_000
  );

  it(
    "rolls stock back when two buyers compete for one affordable purchase",
    async (context) => {
      const databaseUrl = requireDatabaseUrl(context);
      if (!databaseUrl) return;

      await withTempDatabase(databaseUrl, async (harness) => {
        const item = FIRST_ITEMS.find((entry) => entry.id === "rough_hide");
        if (!item) throw new Error("rough_hide fixture missing");
        const affordableBalance = calculateMarketQuote({
          direction: "buy",
          basePriceCopper: item.baseSellPriceCopper,
          stockQuantity: 2,
          targetQuantity: item.targetMarketQuantity,
          quantity: 1
        }).totalCopper;
        const seeded = await seedCharacter(harness.client, { copperBalance: affordableBalance });
        await seedMarket(harness.client, "rough_hide", 2);
        const market = await harness.client.query<{ id: string }>(
          `SELECT id FROM market_inventory WHERE settlement_id = 'blackpine_outpost' AND item_id = 'rough_hide'`
        );
        const marketId = market.rows[0]?.id;
        expect(marketId).toBeTruthy();

        const results = await runBlockedPair(
          harness,
          "SELECT id FROM market_inventory WHERE id = $1 FOR UPDATE",
          [marketId],
          () => harness.firstService.buyMarketItem(seeded.accountId, { itemId: "rough_hide", quantity: 1 }),
          () => harness.secondService.buyMarketItem(seeded.accountId, { itemId: "rough_hide", quantity: 1 })
        );
        expectOneValidationConflict(results);

        const assets = await harness.client.query<{
          copperBalance: number;
          stock: number;
          itemQuantity: number;
          trades: number;
        }>(
          `
            SELECT
              c.copper_balance AS "copperBalance",
              m.quantity AS stock,
              COALESCE(ci.quantity, 0) AS "itemQuantity",
              (SELECT count(*)::int FROM market_transactions WHERE character_id = c.id) AS trades
            FROM characters c
            JOIN market_inventory m ON m.id = $2
            LEFT JOIN character_items ci ON ci.character_id = c.id AND ci.item_id = 'rough_hide'
            WHERE c.id = $1
          `,
          [seeded.characterId, marketId]
        );
        expect(assets.rows[0]).toEqual({ copperBalance: 0, stock: 1, itemQuantity: 1, trades: 1 });
      });
    },
    30_000
  );

  it(
    "charges one repair when two services repair the same equipment",
    async (context) => {
      const databaseUrl = requireDatabaseUrl(context);
      if (!databaseUrl) return;

      await withTempDatabase(databaseUrl, async (harness) => {
        const seeded = await seedCharacter(harness.client, { copperBalance: 500 });
        const equipmentId = randomUUID();
        await harness.client.query(
          `INSERT INTO character_items (character_id, item_id, quantity) VALUES ($1, 'iron_ore', 5)`,
          [seeded.characterId]
        );
        await harness.client.query(
          `
            INSERT INTO character_equipment (
              id, character_id, slot, item_key, name, item_level,
              attack_bonus, defense_bonus, max_durability, current_durability
            )
            VALUES ($1, $2, 'weapon', 'test_blade', 'Test Blade', 10, 1, 0, 100, 50)
          `,
          [equipmentId, seeded.characterId]
        );

        const results = await runBlockedPair(
          harness,
          "SELECT id FROM character_equipment WHERE id = $1 FOR UPDATE",
          [equipmentId],
          () => harness.firstService.repairEquipment(seeded.accountId, { equipmentId }),
          () => harness.secondService.repairEquipment(seeded.accountId, { equipmentId })
        );
        expectOneValidationConflict(results);

        const assets = await harness.client.query<{
          copperBalance: number;
          ironOre: number;
          durability: number;
          repairLedger: number;
          repairEvents: number;
          itemConsumes: number;
        }>(
          `
            SELECT
              c.copper_balance AS "copperBalance",
              ci.quantity AS "ironOre",
              ce.current_durability AS durability,
              (SELECT count(*)::int FROM asset_ledger WHERE operation = 'equipment_repair' AND from_entity_id = c.id::text) AS "repairLedger",
              (SELECT count(*)::int FROM game_events WHERE character_id = c.id AND event_type = 'equipment.repair') AS "repairEvents",
              (SELECT count(*)::int FROM item_ledger WHERE from_owner_id = c.id AND reason = 'equipment.repair') AS "itemConsumes"
            FROM characters c
            JOIN character_items ci ON ci.character_id = c.id AND ci.item_id = 'iron_ore'
            JOIN character_equipment ce ON ce.id = $2
            WHERE c.id = $1
          `,
          [seeded.characterId, equipmentId]
        );
        expect(assets.rows[0]).toEqual({
          copperBalance: 375,
          ironOre: 4,
          durability: 100,
          repairLedger: 1,
          repairEvents: 1,
          itemConsumes: 1
        });
      });
    },
    30_000
  );

  it(
    "creates one active action from overlapping starts",
    async (context) => {
      const databaseUrl = requireDatabaseUrl(context);
      if (!databaseUrl) return;

      await withTempDatabase(databaseUrl, async (harness) => {
        const seeded = await seedCharacter(harness.client, {
          copperBalance: 0,
          currentLocation: "corrupt_forest",
          position: { x: 1, y: 3 }
        });
        await harness.client.query(
          `
            INSERT INTO map_instances (character_id, zone_id, resource_charges)
            VALUES ($1, 'corrupt_forest', $2::jsonb)
          `,
          [seeded.characterId, JSON.stringify({ forest_berry_patch_01: 3 })]
        );

        const results = await runBlockedPair(
          harness,
          "SELECT id FROM characters WHERE id = $1 FOR UPDATE",
          [seeded.characterId],
          () => harness.firstService.startGathering(seeded.accountId, { plannedMinutes: 10 }),
          () => harness.secondService.startGathering(seeded.accountId, { plannedMinutes: 10 })
        );
        expectOneValidationConflict(results);

        const actions = await harness.client.query<{ activeActions: number; startEvents: number }>(
          `
            SELECT
              count(*) FILTER (WHERE status = 'active')::int AS "activeActions",
              (SELECT count(*)::int FROM game_events WHERE character_id = $1 AND event_type = 'action.gathering.start') AS "startEvents"
            FROM character_actions
            WHERE character_id = $1
          `,
          [seeded.characterId]
        );
        expect(actions.rows[0]).toEqual({ activeActions: 1, startEvents: 1 });
      });
    },
    30_000
  );
});
