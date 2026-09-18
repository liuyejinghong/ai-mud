import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { FIRST_ITEMS } from "@ai-mud/content";
import { GameRepository } from "../modules/game/game.repository.js";
import { AssetMutationService } from "../modules/ledger/asset-mutation.service.js";
import { createDb, type Db } from "./client.js";

// G02 evidence (real PostgreSQL): every fault-injection point in the market
// buy sequence — after stock debit, after copper debit, after treasury credit
// — rolls the whole transaction back, leaving no partial asset movement. The
// command receipt makes a retried buy replay instead of double-charging, and
// a same-id/different-payload retry conflicts.

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(testFile)));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

const SETTLEMENT = "blackpine_outpost";
const IRON_ORE = "iron_ore";
const BUY_PRICE = 5;

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL not set; skipping asset mutation PG tests");
    return null;
  }
  return url;
}

function makeTempDatabaseName() {
  return `ai_mud_vitest_assets_${process.pid}_${randomUUID().replace(/-/g, "")}`;
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
  db: Db;
  characterId: string;
  dispose: () => Promise<void>;
}

async function createHarness(databaseUrl: string): Promise<Harness> {
  const { databaseName, targetUrl, client } = await createTempDatabaseFromMigrations(databaseUrl);
  const { db, close } = createDb(targetUrl);

  for (const item of FIRST_ITEMS) {
    await client.query(
      `INSERT INTO market_inventory (settlement_id, item_id, quantity, target_quantity, base_buy_price_copper, base_sell_price_copper)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [SETTLEMENT, item.id, 10, item.targetMarketQuantity, item.baseBuyPriceCopper, item.baseSellPriceCopper]
    );
  }
  await client.query(
    `INSERT INTO municipal_treasury (settlement_id, copper_balance) VALUES ($1, 500)`,
    [SETTLEMENT]
  );
  const account = await client.query(
    `INSERT INTO accounts (email, password_hash, role) VALUES ('assets@it.test', 'x', 'player') RETURNING id`
  );
  const character = await client.query(
    `INSERT INTO characters (account_id, name, class_id, hp, max_hp, copper_balance)
     VALUES ($1, 'Assetor', 'warrior', 20, 20, 200) RETURNING id`,
    [account.rows[0].id]
  );

  return {
    client,
    db,
    characterId: character.rows[0].id,
    dispose: async () => {
      await close();
      await client.end();
      const adminClient = new Client({ connectionString: databaseUrlForName(databaseUrl, "postgres") });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE ${JSON.stringify(databaseName)} WITH (FORCE)`);
      await adminClient.end();
    }
  };
}

interface WorldSnapshot {
  copper: number;
  stock: number;
  treasury: number;
  itemQty: number;
  receipts: number;
}

async function snapshotWorld(client: pg.Client, itemId: string): Promise<WorldSnapshot> {
  const copper = await client.query("SELECT copper_balance FROM characters LIMIT 1");
  const stock = await client.query(
    "SELECT quantity FROM market_inventory WHERE settlement_id = $1 AND item_id = $2",
    [SETTLEMENT, itemId]
  );
  const treasury = await client.query(
    "SELECT copper_balance FROM municipal_treasury WHERE settlement_id = $1",
    [SETTLEMENT]
  );
  const itemQty = await client.query("SELECT COALESCE(SUM(quantity), 0) AS qty FROM character_items");
  const receipts = await client.query("SELECT COUNT(*)::int AS n FROM command_receipts");
  return {
    copper: copper.rows[0].copper_balance,
    stock: stock.rows[0].quantity,
    treasury: treasury.rows[0].copper_balance,
    itemQty: Number(itemQty.rows[0].qty),
    receipts: receipts.rows[0].n
  };
}

describe("asset mutation fault isolation (real PostgreSQL)", () => {
  it.each([
    ["after stock debit", "copper"],
    ["after copper debit", "treasury"],
    ["after treasury credit", "grant"]
  ])("rolls the whole buy back when the injection point is %s", async (_label, failAt) => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const harness = await createHarness(databaseUrl);
    try {
      const { db, client, characterId } = harness;
      const before = await snapshotWorld(client, IRON_ORE);

      await expect(
        db.transaction(async (tx) => {
          const txAssets = new AssetMutationService(tx);
          const txRepo = new GameRepository(tx);
          const market = await txRepo.findMarketInventoryItemForUpdate(SETTLEMENT, IRON_ORE);
          if (!market) throw new Error("no market row");

          if (!(await txAssets.debitMarketStockIfAvailable(market.id, 1))) throw new Error("stock");
          if (failAt === "copper") throw new Error("injected: after stock debit");
          if (!(await txAssets.debitCharacterCopperIfAvailable(characterId, BUY_PRICE))) {
            throw new Error("copper");
          }
          if (failAt === "treasury") throw new Error("injected: after copper debit");
          await txAssets.creditTreasury(SETTLEMENT, BUY_PRICE);
          if (failAt === "grant") throw new Error("injected: after treasury credit");
          await txRepo.grantCharacterItem({
            characterId,
            itemId: IRON_ORE,
            quantity: 1,
            reason: "market.buy",
            metadata: {}
          });
          await txAssets.saveReceiptResult({
            actorScope: `character:${characterId}`,
            commandKind: "market.buy",
            commandId: randomUUID(),
            result: { ok: true }
          });
        })
      ).rejects.toThrow("injected");

      const after = await snapshotWorld(client, IRON_ORE);
      expect(after).toEqual(before);
    } finally {
      await harness.dispose();
    }
  });

  it("replays a repeated market buy command instead of double-charging", async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const harness = await createHarness(databaseUrl);
    try {
      const { db, client, characterId } = harness;
      const commandId = randomUUID();
      const actorScope = `character:${characterId}`;
      const requestHash = "sha256:" + Buffer.from(`${IRON_ORE}:1`).toString("hex");
      const assets = new AssetMutationService(db);

      const runBuy = async () =>
        db.transaction(async (tx) => {
          const txAssets = new AssetMutationService(tx);
          const txRepo = new GameRepository(tx);
          const market = await txRepo.findMarketInventoryItemForUpdate(SETTLEMENT, IRON_ORE);
          if (!market) throw new Error("no market row");
          const existing = await txAssets.findReceiptForUpdate(actorScope, "market.buy", commandId);
          if (existing) {
            if (existing.requestHash !== requestHash) throw new Error("conflict");
            return { replayed: true as const };
          }
          if (
            !(await txAssets.claimReceipt({
              actorScope,
              commandKind: "market.buy",
              commandId,
              requestHash
            }))
          ) {
            throw new Error("claim lost");
          }
          if (!(await txAssets.debitMarketStockIfAvailable(market.id, 1))) throw new Error("stock");
          if (!(await txAssets.debitCharacterCopperIfAvailable(characterId, BUY_PRICE))) throw new Error("copper");
          await txAssets.creditTreasury(SETTLEMENT, BUY_PRICE);
          await txAssets.saveReceiptResult({ actorScope, commandKind: "market.buy", commandId, result: { ok: true } });
          return { replayed: false as const };
        });

      const first = await runBuy();
      const second = await runBuy();

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      const after = await snapshotWorld(client, IRON_ORE);
      expect(after.copper).toBe(195); // 200 - 5, charged exactly once
      expect(after.stock).toBe(9);
      expect(after.treasury).toBe(505);
      expect(after.receipts).toBe(1);

      // Same id, different payload → conflict, no state change.
      await expect(
        db.transaction(async (tx) => {
          const txAssets = new AssetMutationService(tx);
          const existing = await txAssets.findReceiptForUpdate(actorScope, "market.buy", commandId);
          if (existing && existing.requestHash !== hashOf({ itemId: IRON_ORE, quantity: 3 })) {
            throw new Error("conflict");
          }
        })
      ).rejects.toThrow("conflict");
      expect((await snapshotWorld(client, IRON_ORE)).copper).toBe(195);
    } finally {
      await harness.dispose();
    }
  });
});

function hashOf(payload: unknown): string {
  return "sha256:" + Buffer.from(JSON.stringify(payload)).toString("hex");
}
