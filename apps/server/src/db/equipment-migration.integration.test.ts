import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { GameService } from "../modules/game/game.service.js";
import { createDb, type Db } from "./client.js";

// G04 evidence (real PostgreSQL): legacy character_equipment rows migrate
// into item_instances with identical ids, slots, base stats and durability;
// rerunning the migration inserts nothing (idempotent); a conflicting
// existing instance is never silently overwritten; new characters and
// repairs run on the single source afterwards.

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(testFile)));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

const MIGRATION_TAG = "0027_equipment_single_source";

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL not set; skipping equipment migration PG tests");
    return null;
  }
  return url;
}

function makeTempDatabaseName() {
  return `ai_mud_vitest_equipment_${process.pid}_${randomUUID().replace(/-/g, "")}`;
}

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

async function applyMigrations(client: pg.Client, entries: Journal["entries"]) {
  for (const entry of entries) {
    const sql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await client.query(statement);
    }
  }
}

async function createPhasedHarness(databaseUrl: string) {
  const databaseName = makeTempDatabaseName();
  const adminClient = new Client({ connectionString: databaseUrlForName(databaseUrl, "postgres") });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${JSON.stringify(databaseName)}`);
  await adminClient.end();

  const targetUrl = databaseUrlForName(databaseUrl, databaseName);
  const client = new Client({ connectionString: targetUrl });
  await client.connect();

  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const before = journal.entries.filter((entry) => entry.tag < MIGRATION_TAG);
  const after = journal.entries.filter((entry) => entry.tag >= MIGRATION_TAG);

  await applyMigrations(client, before);
  await client.query(
    `INSERT INTO accounts (email, password_hash, role) VALUES ('equip@it.test', 'x', 'player') RETURNING id`
  );
  const account = await client.query(`SELECT id FROM accounts WHERE email = 'equip@it.test'`);
  const characterId = (
    await client.query(
      `INSERT INTO characters (account_id, name, class_id, hp, max_hp, copper_balance)
       VALUES ($1, 'Smith', 'warrior', 20, 20, 300) RETURNING id`,
      [account.rows[0].id]
    )
  ).rows[0].id;

  const applyRemainingMigrations = async () => applyMigrations(client, after);

  const { db, close } = createDb(targetUrl);
  return {
    client,
    db,
    characterId,
    applyRemainingMigrations,
    dispose: async () => {
      await close();
      await client.end();
      const dropClient = new Client({ connectionString: databaseUrlForName(databaseUrl, "postgres") });
      await dropClient.connect();
      await dropClient.query(`DROP DATABASE ${JSON.stringify(databaseName)} WITH (FORCE)`);
      await dropClient.end();
    }
  };
}

async function seedLegacyEquipment(client: pg.Client, characterId: string) {
  await client.query(
    `INSERT INTO character_equipment (id, character_id, slot, item_key, name, item_level, attack_bonus, defense_bonus, max_durability, current_durability)
     VALUES ($1, $2, 'weapon', 'training_sword', '训练短剑', 5, 2, 0, 100, 40)`,
    [randomUUID(), characterId]
  );
}

describe("equipment single source migration (real PostgreSQL)", () => {
  it("migrates legacy equipment with identical stats and never overwrites existing instances", async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const harness = await createPhasedHarness(databaseUrl);
    try {
      const { client, characterId } = harness;
      const legacyId = randomUUID();
      await seedLegacyEquipment(client, characterId);

      // A pre-existing instance that happens to own the same uuid must win.
      await client.query(
        `INSERT INTO item_instances (id, item_def_id, owner_type, owner_id, location_type, slot, rarity, item_level, base_stats, affixes, max_durability, current_durability)
         VALUES ($1, 'rare_relic', 'character', $2, 'inventory', null, 'rare', 9, '{"attack": 99}'::jsonb, '[]'::jsonb, 7, 7)`,
        [legacyId, characterId]
      );

      const secondLegacyId = randomUUID();
      await client.query(
        `INSERT INTO character_equipment (id, character_id, slot, item_key, name, item_level, attack_bonus, defense_bonus, max_durability, current_durability)
         VALUES ($1, $2, 'chest', 'patched_leather_vest', '补丁皮甲', 5, 0, 2, 100, 55)`,
        [secondLegacyId, characterId]
      );

      // Apply the migration in two steps so the partial-failure window
      // (rows inserted, table not yet dropped) can be exercised.
      const fullMigration = await readFile(join(drizzleDir, `${MIGRATION_TAG}.sql`), "utf8");
      const insertPart = fullMigration.split("DROP TABLE")[0] ?? "";
      const dropPart = "DROP TABLE character_equipment;";
      await client.query(insertPart);

      const migrated = await client.query(
        `SELECT id, item_def_id, location_type, slot, base_stats, max_durability, current_durability
         FROM item_instances WHERE id = $1`,
        [secondLegacyId]
      );
      expect(migrated.rows).toHaveLength(1);
      expect(migrated.rows[0]).toMatchObject({
        item_def_id: "patched_leather_vest",
        location_type: "equipped",
        slot: "chest",
        base_stats: { attack: 0, defense: 2, agility: 0, maxHp: 0 },
        max_durability: 100,
        current_durability: 55
      });

      // Conflicting uuid: the pre-existing instance is untouched (no silent overwrite).
      const conflicted = await client.query(`SELECT * FROM item_instances WHERE id = $1`, [legacyId]);
      expect(conflicted.rows[0]).toMatchObject({
        item_def_id: "rare_relic",
        max_durability: 7,
        current_durability: 7
      });

      // Idempotent inside the partial-failure window: replaying the insert
      // claims nothing new while the legacy table still exists.
      const before = await client.query(`SELECT COUNT(*)::int AS n FROM item_instances`);
      await client.query(insertPart);
      const after = await client.query(`SELECT COUNT(*)::int AS n FROM item_instances`);
      expect(after.rows[0].n).toBe(before.rows[0].n);

      await client.query(dropPart);

      // The legacy table itself is gone; the migrated instances remain.
      expect((await client.query(`SELECT to_regclass('character_equipment')`)).rows[0].to_regclass).toBeNull();
      const kept = await client.query(
        `SELECT COUNT(*)::int AS n FROM item_instances WHERE owner_id = $1`,
        [characterId]
      );
      // 2 migrated legacy rows + the pre-existing conflicting instance.
      expect(kept.rows[0].n).toBe(3);
    } finally {
      await harness.dispose();
    }
  });

  it("creates new characters and repairs on the single source", async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const harness = await createPhasedHarness(databaseUrl);
    try {
      const { db, client, characterId } = harness;
      seedLegacyEquipment(client, characterId);
      await harness.applyRemainingMigrations();

      // A brand-new character gets instance-based starter gear (no legacy rows).
      const secondAccount = await client.query(
        `INSERT INTO accounts (email, password_hash, role) VALUES ('equip2@it.test', 'x', 'player') RETURNING id`
      );
      const service = new GameService(db);
      await service.createCharacter(secondAccount.rows[0].id, { name: "Newcomer", classId: "warrior" });

      const equipped = await client.query(
        `SELECT c.name, i.item_def_id, i.slot, i.base_stats, i.max_durability, i.current_durability
         FROM item_instances i
         JOIN characters c ON c.id = i.owner_id
         WHERE i.owner_type = 'character' AND i.location_type = 'equipped'
         ORDER BY c.name, i.slot`
      );
      // Migrated legacy gear (Smith) + instance-based starter gear (Newcomer).
      expect(equipped.rows).toHaveLength(3);
      const starterSwords = equipped.rows.filter(
        (row) => row.name === "Newcomer" && row.item_def_id === "training_sword"
      );
      expect(starterSwords).toHaveLength(1);
      expect(starterSwords[0]).toMatchObject({
        slot: "weapon",
        base_stats: { attack: 2, defense: 0 },
        current_durability: 100
      });

      // Repair runs on the single source: durability restored, copper charged.
      const damaged = await client.query(
        `UPDATE item_instances SET current_durability = 10
         WHERE item_def_id = 'training_sword' AND owner_id = $1 RETURNING id`,
        [characterId]
      );
      expect(damaged.rows).toHaveLength(1);
      await client.query(
        `INSERT INTO character_items (character_id, item_id, quantity) VALUES ($1, 'iron_ore', 5)`,
        [characterId]
      );
      const smithAccount = (await client.query(`SELECT account_id FROM characters WHERE id = $1`, [characterId])).rows[0].account_id;
      const repairedId = (
        await client.query(
          `SELECT id FROM item_instances WHERE item_def_id = 'training_sword' AND owner_id = $1`,
          [characterId]
        )
      ).rows[0].id;
      const state = await service.repairEquipment(smithAccount, { equipmentId: repairedId });
      expect(state.equipment?.find((item) => item.id === repairedId)?.currentDurability).toBe(100);
      const durability = await client.query(
        `SELECT current_durability FROM item_instances WHERE item_def_id = 'training_sword' AND owner_id = $1`,
        [characterId]
      );
      expect(Number(durability.rows[0].current_durability)).toBe(100);
      const copper = await client.query(`SELECT copper_balance FROM characters WHERE id = $1`, [characterId]);
      expect(copper.rows[0].copper_balance).toBeLessThan(300);
      void db;
    } finally {
      await harness.dispose();
    }
  });
});
