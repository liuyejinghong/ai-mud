import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../../db/client.js";
import {
  characters,
  commandReceipts,
  marketInventory,
  municipalTreasury,
  worldActors
} from "../../db/schema.js";

// Assets is the only writer of copper balances, market stock, treasury and
// escrow amounts (modularity.md §7). Every method MUST be called inside the
// caller's transaction: this service never opens or commits one.

export type AssetMutationTx = Pick<Db, "delete" | "insert" | "select" | "update"> & {
  transaction?: Db["transaction"];
};

export type AssetMutationDb = AssetMutationTx;

export interface CommandReceipt {
  actorScope: string;
  commandKind: string;
  commandId: string;
  worldEpoch: number;
  requestHash: string;
  result: unknown;
}

export function hashRequest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

export function newCommandId(): string {
  return randomUUID();
}

export interface AssetMutationPort {
  debitCharacterCopperIfAvailable(characterId: string, amount: number): Promise<boolean>;
  creditCharacterCopper(characterId: string, amount: number): Promise<void>;
  debitNpcCopperIfAvailable(actorId: string, amount: number): Promise<boolean>;
  reserveNpcCopper(actorId: string, amount: number, reserve: number): Promise<boolean>;
  creditNpcCopper(actorId: string, amount: number): Promise<void>;
  creditTreasury(settlementId: string, amount: number): Promise<void>;
  debitTreasuryIfAvailable(settlementId: string, amount: number): Promise<boolean>;
  debitMarketStockIfAvailable(marketInventoryId: string, quantity: number): Promise<boolean>;
  debitMarketStockAboveReserve(
    marketInventoryId: string,
    quantity: number,
    reserveQuantity: number
  ): Promise<boolean>;
  creditMarketStock(marketInventoryId: string, quantity: number): Promise<void>;
  findReceiptForUpdate(
    actorScope: string,
    commandKind: string,
    commandId: string,
    worldEpoch?: number
  ): Promise<CommandReceipt | null>;
  claimReceipt(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    worldEpoch?: number;
    requestHash: string;
  }): Promise<boolean>;
  saveReceiptResult(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    worldEpoch?: number;
    result: unknown;
  }): Promise<void>;
}

export class AssetMutationService implements AssetMutationPort {
  constructor(private readonly db: AssetMutationDb) {}

  // ---------- copper ----------

  async debitCharacterCopperIfAvailable(characterId: string, amount: number): Promise<boolean> {
    const rows = await this.db
      .update(characters)
      .set({ copperBalance: sqlMinus(characters.copperBalance, amount) })
      .where(and(eq(characters.id, characterId), gteCopper(characters.copperBalance, amount)))
      .returning({ id: characters.id });
    return rows.length > 0;
  }

  async creditCharacterCopper(characterId: string, amount: number): Promise<void> {
    await this.db
      .update(characters)
      .set({ copperBalance: sqlPlus(characters.copperBalance, amount) })
      .where(eq(characters.id, characterId));
  }

  async debitNpcCopperIfAvailable(actorId: string, amount: number): Promise<boolean> {
    const rows = await this.db
      .update(worldActors)
      .set({ copperBalance: sqlMinus(worldActors.copperBalance, amount) })
      .where(and(eq(worldActors.id, actorId), gteCopper(worldActors.copperBalance, amount)))
      .returning({ id: worldActors.id });
    return rows.length > 0;
  }

  async reserveNpcCopper(actorId: string, amount: number, reserve: number): Promise<boolean> {
    const rows = await this.db
      .update(worldActors)
      .set({ copperBalance: sqlMinus(worldActors.copperBalance, amount) })
      .where(
        and(
          eq(worldActors.id, actorId),
          gteCopper(worldActors.copperBalance, amount + reserve)
        )
      )
      .returning({ id: worldActors.id });
    return rows.length > 0;
  }

  async creditNpcCopper(actorId: string, amount: number): Promise<void> {
    await this.db
      .update(worldActors)
      .set({ copperBalance: sqlPlus(worldActors.copperBalance, amount) })
      .where(eq(worldActors.id, actorId));
  }

  async creditTreasury(settlementId: string, amount: number): Promise<void> {
    await this.db
      .update(municipalTreasury)
      .set({ copperBalance: sqlPlus(municipalTreasury.copperBalance, amount) })
      .where(eq(municipalTreasury.settlementId, settlementId));
  }

  async debitTreasuryIfAvailable(settlementId: string, amount: number): Promise<boolean> {
    const rows = await this.db
      .update(municipalTreasury)
      .set({ copperBalance: sqlMinus(municipalTreasury.copperBalance, amount) })
      .where(
        and(
          eq(municipalTreasury.settlementId, settlementId),
          gteCopper(municipalTreasury.copperBalance, amount)
        )
      )
      .returning({ settlementId: municipalTreasury.settlementId });
    return rows.length > 0;
  }

  // ---------- market stock ----------

  async debitMarketStockIfAvailable(marketInventoryId: string, quantity: number): Promise<boolean> {
    const rows = await this.db
      .update(marketInventory)
      .set({ quantity: sqlMinus(marketInventory.quantity, quantity) })
      .where(and(eq(marketInventory.id, marketInventoryId), gteStock(marketInventory.quantity, quantity)))
      .returning({ id: marketInventory.id });
    return rows.length > 0;
  }

  async creditMarketStock(marketInventoryId: string, quantity: number): Promise<void> {
    await this.db
      .update(marketInventory)
      .set({ quantity: sqlPlus(marketInventory.quantity, quantity) })
      .where(eq(marketInventory.id, marketInventoryId));
  }

  async debitMarketStockAboveReserve(
    marketInventoryId: string,
    quantity: number,
    reserveQuantity: number
  ): Promise<boolean> {
    const rows = await this.db
      .update(marketInventory)
      .set({ quantity: sqlMinus(marketInventory.quantity, quantity) })
      .where(
        and(
          eq(marketInventory.id, marketInventoryId),
          gteStock(marketInventory.quantity, quantity + reserveQuantity)
        )
      )
      .returning({ id: marketInventory.id });
    return rows.length > 0;
  }

  // ---------- command receipts ----------

  // FOR UPDATE: a concurrent same-command transaction blocks here until the
  // first one commits, then replays its stored result.
  async findReceiptForUpdate(
    actorScope: string,
    commandKind: string,
    commandId: string,
    worldEpoch = 1
  ): Promise<CommandReceipt | null> {
    const [row] = await this.db
      .select()
      .from(commandReceipts)
      .where(
        and(
          eq(commandReceipts.actorScope, actorScope),
          eq(commandReceipts.commandKind, commandKind),
          eq(commandReceipts.commandId, commandId),
          eq(commandReceipts.worldEpoch, worldEpoch)
        )
      )
      .limit(1)
      .for("update");
    return row
      ? {
          actorScope: row.actorScope,
          commandKind: row.commandKind,
          commandId: row.commandId,
          worldEpoch: row.worldEpoch,
          requestHash: row.requestHash,
          result: row.result
        }
      : null;
  }

  // Claims the command id inside the caller's transaction. Returns false when
  // the id is already claimed (the caller must then replay or conflict).
  async claimReceipt(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    worldEpoch?: number;
    requestHash: string;
  }): Promise<boolean> {
    const rows = await this.db
      .insert(commandReceipts)
      .values({
        actorScope: input.actorScope,
        commandKind: input.commandKind,
        commandId: input.commandId,
        worldEpoch: input.worldEpoch ?? 1,
        requestHash: input.requestHash,
        result: { status: "pending" }
      })
      .onConflictDoNothing({
        target: [
          commandReceipts.actorScope,
          commandReceipts.commandKind,
          commandReceipts.commandId,
          commandReceipts.worldEpoch
        ]
      })
      .returning({ id: commandReceipts.id });
    return rows.length > 0;
  }

  async saveReceiptResult(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    worldEpoch?: number;
    result: unknown;
  }): Promise<void> {
    await this.db
      .update(commandReceipts)
      .set({ result: input.result })
      .where(
        and(
          eq(commandReceipts.actorScope, input.actorScope),
          eq(commandReceipts.commandKind, input.commandKind),
          eq(commandReceipts.commandId, input.commandId),
          eq(commandReceipts.worldEpoch, input.worldEpoch ?? 1)
        )
      );
  }
}

// Local arithmetic helpers keep the exact ON-db increment/decrement form the
// conditional updates rely on.
function sqlMinus(column: PgColumn, amount: number) {
  return sql`${column} - ${amount}`;
}

function sqlPlus(column: PgColumn, amount: number) {
  return sql`${column} + ${amount}`;
}

function gteCopper(column: PgColumn, amount: number) {
  return sql`${column} >= ${amount}`;
}

function gteStock(column: PgColumn, quantity: number) {
  return sql`${column} >= ${quantity}`;
}
