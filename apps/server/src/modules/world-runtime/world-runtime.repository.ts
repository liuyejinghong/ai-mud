import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { worldRuntimeState } from "../../db/schema.js";

export interface WorldRuntimeProgress {
  key: string;
  lastSettledAt: Date | null;
}

type WorldRuntimeDb = Pick<Db, "insert" | "select" | "update"> & {
  transaction?: Db["transaction"];
};

// Tick participants receive this handle: broad enough to construct any module
// persistence (npc/game/ledger) bound to the same transaction.
export type WorldRuntimeTx = Pick<Db, "delete" | "insert" | "select" | "update"> & {
  transaction?: Db["transaction"];
};

export interface WorldRuntimeRepositoryPort {
  find(key: string): Promise<WorldRuntimeProgress | null>;
  ensureRow(key: string, initialLastSettledAt: Date): Promise<void>;
  lockAndRead(key: string): Promise<WorldRuntimeProgress | null>;
  saveProgress(input: { key: string; lastSettledAt: Date; now: Date }): Promise<void>;
  transaction<T>(
    operation: (txRepo: WorldRuntimeRepositoryPort, tx: WorldRuntimeTx) => Promise<T>
  ): Promise<T>;
}

export class WorldRuntimeRepository implements WorldRuntimeRepositoryPort {
  constructor(private readonly db: WorldRuntimeDb) {}

  async transaction<T>(
    operation: (txRepo: WorldRuntimeRepositoryPort, tx: WorldRuntimeTx) => Promise<T>
  ): Promise<T> {
    if (!this.db.transaction) {
      return operation(this, this.db as unknown as WorldRuntimeTx);
    }
    return this.db.transaction(async (tx) =>
      operation(new WorldRuntimeRepository(tx), tx as unknown as WorldRuntimeTx)
    );
  }

  async find(key: string): Promise<WorldRuntimeProgress | null> {
    const [row] = await this.db
      .select({ lastSettledAt: worldRuntimeState.lastSettledAt })
      .from(worldRuntimeState)
      .where(eq(worldRuntimeState.key, key))
      .limit(1);

    return row ? { key, lastSettledAt: row.lastSettledAt } : null;
  }

  async ensureRow(key: string, initialLastSettledAt: Date): Promise<void> {
    await this.db
      .insert(worldRuntimeState)
      .values({ key, lastSettledAt: initialLastSettledAt })
      .onConflictDoNothing({ target: worldRuntimeState.key });
  }

  // Must run inside the caller's transaction: the row lock is the tick mutex.
  async lockAndRead(key: string): Promise<WorldRuntimeProgress | null> {
    const [row] = await this.db
      .select({ lastSettledAt: worldRuntimeState.lastSettledAt })
      .from(worldRuntimeState)
      .where(eq(worldRuntimeState.key, key))
      .limit(1)
      .for("update");

    return row ? { key, lastSettledAt: row.lastSettledAt } : null;
  }

  // Must run inside the same transaction as lockAndRead.
  async saveProgress(input: { key: string; lastSettledAt: Date; now: Date }): Promise<void> {
    await this.db
      .update(worldRuntimeState)
      .set({ lastSettledAt: input.lastSettledAt, updatedAt: input.now })
      .where(eq(worldRuntimeState.key, input.key));
  }
}
