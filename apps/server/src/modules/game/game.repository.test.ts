import { describe, expect, it, vi } from "vitest";
import {
  GameRepository,
  parseActionPayload,
  serializeEncounterCooldowns,
  serializeEquipmentDurability,
  serializeHunger,
  serializeActionPayload,
  serializeMarketTransaction,
  serializeResourceCharges,
  type GatheringActionPayload
} from "./game.repository.js";

function createSelectDb(rows: unknown[]) {
  const forUpdate = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn(() => ({ for: forUpdate }));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select },
    forUpdate
  };
}

function createSequentialSelectDb(rowSets: unknown[][]) {
  const forUpdate = vi.fn();
  for (const rows of rowSets) forUpdate.mockResolvedValueOnce(rows);
  const limit = vi.fn(() => ({ for: forUpdate }));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select },
    forUpdate
  };
}

function createUpdateDb(returnedRows: unknown[][]) {
  const returning = vi.fn();
  for (const rows of returnedRows) returning.mockResolvedValueOnce(rows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn((_values: unknown) => ({ where }));
  const update = vi.fn(() => ({ set }));

  return { update, set, where, returning };
}

describe("game repository helpers", () => {
  it("serializes resource charges for the map state json", () => {
    expect(serializeResourceCharges({ forest_berry_patch_01: 2 })).toEqual({
      forest_berry_patch_01: 2
    });
  });

  it("serializes encounter cooldowns as valid timestamp strings only", () => {
    expect(
      serializeEncounterCooldowns({
        old_mine_rat_pack_01: "2026-07-02T08:10:00.000Z",
        broken: "not-a-date",
        "": "2026-07-02T08:10:00.000Z"
      })
    ).toEqual({
      old_mine_rat_pack_01: "2026-07-02T08:10:00.000Z"
    });
  });

  it("round-trips gathering action payloads", () => {
    const payload: GatheringActionPayload = {
      resourceId: "forest_berry_patch_01",
      itemId: "wild_berry",
      itemName: "野莓",
      quantityPerCycle: 2,
      cycleMs: 30000,
      plannedCycles: 20,
      settledCycles: 3
    };

    expect(parseActionPayload("gathering", serializeActionPayload(payload))).toEqual(payload);
  });

  it("serializes equipment durability with clamped integer values", () => {
    expect(serializeEquipmentDurability({ currentDurability: 150, maxDurability: 100 })).toEqual({
      currentDurability: 100,
      maxDurability: 100
    });
    expect(serializeEquipmentDurability({ currentDurability: -5, maxDurability: 100 })).toEqual({
      currentDurability: 0,
      maxDurability: 100
    });
  });

  it("serializes hunger with clamped integer values", () => {
    expect(serializeHunger(8)).toBe(5);
    expect(serializeHunger(-1)).toBe(0);
    expect(serializeHunger(2.8)).toBe(2);
  });

  it("serializes market transactions for economy visibility", () => {
    const createdAt = new Date("2026-07-01T12:00:00.000Z");

    expect(
      serializeMarketTransaction({
        id: "tx-1",
        settlementId: "blackpine_outpost",
        characterId: "character-1",
        actorType: "player",
        actorId: "character-1",
        actorName: "测试角色",
        transactionType: "sell",
        itemId: "wild_berry",
        quantity: 3,
        unitPriceCopper: 6,
        grossCopper: 18,
        taxCopper: 1,
        netCopper: 17,
        createdAt
      })
    ).toEqual({
      id: "tx-1",
      settlementId: "blackpine_outpost",
      characterId: "character-1",
      actorType: "player",
      actorId: "character-1",
      actorName: "测试角色",
      transactionType: "sell",
      itemId: "wild_berry",
      quantity: 3,
      unitPriceCopper: 6,
      grossCopper: 18,
      taxCopper: 1,
      netCopper: 17,
      createdAt
    });
  });
});

describe("GameRepository locking contracts", () => {
  it("locks and maps one market inventory row", async () => {
    const { db, forUpdate } = createSelectDb([
      {
        id: "market-1",
        settlementId: "blackpine_outpost",
        itemId: "iron_ore",
        quantity: 12,
        targetQuantity: 20,
        baseBuyPriceCopper: 4,
        baseSellPriceCopper: 7
      }
    ]);
    const repository = new GameRepository(db as never);

    await expect(
      repository.findMarketInventoryItemForUpdate("blackpine_outpost", "iron_ore")
    ).resolves.toEqual({
      id: "market-1",
      settlementId: "blackpine_outpost",
      itemId: "iron_ore",
      quantity: 12,
      targetQuantity: 20,
      baseBuyPriceCopper: 4,
      baseSellPriceCopper: 7
    });
    expect(forUpdate).toHaveBeenCalledWith("update");
  });

  it("locks and maps legacy equipment before repair", async () => {
    const { db, forUpdate } = createSelectDb([
      {
        id: "equipment-1",
        characterId: "character-1",
        slot: "weapon",
        itemKey: "training_sword",
        name: "训练短剑",
        itemLevel: 5,
        attackBonus: 2,
        defenseBonus: 0,
        maxDurability: 100,
        currentDurability: 40
      }
    ]);
    const repository = new GameRepository(db as never);

    await expect(
      repository.findEquipmentByIdForUpdate("character-1", "equipment-1")
    ).resolves.toMatchObject({ id: "equipment-1", currentDurability: 40 });
    expect(forUpdate).toHaveBeenCalledWith("update");
  });

  it("falls back to locking an equipped item instance before repair", async () => {
    const { db, forUpdate } = createSequentialSelectDb([
      [],
      [
        {
          id: "instance-1",
          itemDefId: "training_sword",
          ownerType: "character",
          ownerId: "character-1",
          locationType: "equipped",
          locationId: null,
          slot: "weapon",
          rarity: "common",
          itemLevel: 5,
          baseStats: { attack: 2 },
          affixes: [],
          maxDurability: 100,
          currentDurability: 40
        }
      ]
    ]);
    const repository = new GameRepository(db as never);

    await expect(
      repository.findEquipmentByIdForUpdate("character-1", "instance-1")
    ).resolves.toMatchObject({ id: "instance-1", currentDurability: 40 });
    expect(forUpdate).toHaveBeenCalledTimes(2);
    expect(forUpdate).toHaveBeenNthCalledWith(1, "update");
    expect(forUpdate).toHaveBeenNthCalledWith(2, "update");
  });

  it("locks and maps the active action for a character", async () => {
    const startedAt = new Date("2026-07-13T01:00:00.000Z");
    const endsAt = new Date("2026-07-13T01:10:00.000Z");
    const payload: GatheringActionPayload = {
      resourceId: "forest_berry_patch_01",
      itemId: "wild_berry",
      itemName: "野莓",
      quantityPerCycle: 2,
      cycleMs: 30000,
      plannedCycles: 20,
      settledCycles: 3
    };
    const { db, forUpdate } = createSelectDb([
      {
        id: "action-1",
        characterId: "character-1",
        actionType: "gathering",
        status: "active",
        startedAt,
        endsAt,
        payload: serializeActionPayload(payload)
      }
    ]);
    const repository = new GameRepository(db as never);

    await expect(repository.findActiveActionForUpdate("character-1")).resolves.toEqual({
      id: "action-1",
      characterId: "character-1",
      actionType: "gathering",
      status: "active",
      startedAt,
      endsAt,
      payload
    });
    expect(forUpdate).toHaveBeenCalledWith("update");
  });

  it("returns null when no active action can be locked", async () => {
    const { db, forUpdate } = createSelectDb([]);
    const repository = new GameRepository(db as never);

    await expect(repository.findActiveActionForUpdate("character-1")).resolves.toBeNull();
    expect(forUpdate).toHaveBeenCalledWith("update");
  });

  it("locks and maps the character map instance", async () => {
    const { db, forUpdate } = createSelectDb([
      {
        id: "map-1",
        characterId: "character-1",
        zoneId: "corrupt_forest",
        resourceCharges: {
          forest_berry_patch_01: 2,
          invalid: "not-a-number"
        },
        encounterCooldowns: {
          old_mine_rat_pack_01: "2026-07-13T01:10:00.000Z",
          broken: "not-a-date"
        }
      }
    ]);
    const repository = new GameRepository(db as never);

    await expect(
      repository.findMapInstanceForUpdate("character-1", "corrupt_forest")
    ).resolves.toEqual({
      id: "map-1",
      characterId: "character-1",
      zoneId: "corrupt_forest",
      resourceCharges: { forest_berry_patch_01: 2 },
      encounterCooldowns: {
        old_mine_rat_pack_01: "2026-07-13T01:10:00.000Z"
      }
    });
    expect(forUpdate).toHaveBeenCalledWith("update");
  });

  it("returns null when no map instance can be locked", async () => {
    const { db, forUpdate } = createSelectDb([]);
    const repository = new GameRepository(db as never);

    await expect(
      repository.findMapInstanceForUpdate("character-1", "corrupt_forest")
    ).resolves.toBeNull();
    expect(forUpdate).toHaveBeenCalledWith("update");
  });
});

describe("GameRepository affected-row contracts", () => {
  it.each([
    ["character copper", "decrementCharacterCopperIfAvailable", { characterId: "character-1", amount: 10 }],
    [
      "municipal treasury",
      "decrementMunicipalTreasuryIfAvailable",
      { settlementId: "blackpine_outpost", amount: 10 }
    ],
    [
      "market inventory",
      "decrementMarketInventoryIfAvailable",
      { marketInventoryId: "market-1", quantity: 2 }
    ]
  ])("returns false when the %s conditional debit affects no row", async (_label, method, input) => {
    const repository = new GameRepository(createUpdateDb([[]]) as never);

    await expect(
      (repository[method as keyof GameRepository] as (value: typeof input) => Promise<boolean>)(input)
    ).resolves.toBe(false);
  });

  it("increments market inventory with an atomic SQL expression", async () => {
    const db = createUpdateDb([[{ id: "market-1" }]]);
    const repository = new GameRepository(db as never);

    await repository.incrementMarketInventory({ marketInventoryId: "market-1", quantity: 3 });

    expect(db.set).toHaveBeenCalledTimes(1);
    const values = db.set.mock.calls[0]![0] as { quantity: unknown };
    expect(values.quantity).not.toBe(3);
    expect(values.quantity).toBeTypeOf("object");
  });

  it("reports whether an active action was completed", async () => {
    const repository = new GameRepository(createUpdateDb([[{ id: "action-1" }], []]) as never);
    const completedAt = new Date("2026-07-13T01:10:00.000Z");

    await expect(repository.markActionCompleted("action-1", completedAt)).resolves.toBe(true);
    await expect(repository.markActionCompleted("action-1", completedAt)).resolves.toBe(false);
  });

  it("reports whether an active action was cancelled", async () => {
    const repository = new GameRepository(createUpdateDb([[{ id: "action-1" }], []]) as never);
    const cancelledAt = new Date("2026-07-13T01:10:00.000Z");

    await expect(repository.markActionCancelled("action-1", cancelledAt)).resolves.toBe(true);
    await expect(repository.markActionCancelled("action-1", cancelledAt)).resolves.toBe(false);
  });
});
