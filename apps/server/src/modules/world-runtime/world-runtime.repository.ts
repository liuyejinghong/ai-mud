import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { worldRuntimeState } from "../../db/schema.js";

export interface WorldRuntimeRecord {
  key: string;
  lastSettledAt: Date | null;
  leaseOwner: string | null;
  leaseUntil: Date | null;
}

type WorldRuntimeDb = Pick<Db, "insert" | "select" | "update">;

export class WorldRuntimeRepository {
  constructor(private readonly db: WorldRuntimeDb) {}

  async find(key: string): Promise<WorldRuntimeRecord | null> {
    const [row] = await this.db
      .select()
      .from(worldRuntimeState)
      .where(eq(worldRuntimeState.key, key))
      .limit(1);

    return row
      ? {
          key: row.key,
          lastSettledAt: row.lastSettledAt,
          leaseOwner: row.leaseOwner,
          leaseUntil: row.leaseUntil
        }
      : null;
  }

  async upsert(input: WorldRuntimeRecord): Promise<void> {
    const existing = await this.find(input.key);
    if (existing) {
      await this.db
        .update(worldRuntimeState)
        .set({
          lastSettledAt: input.lastSettledAt,
          leaseOwner: input.leaseOwner,
          leaseUntil: input.leaseUntil,
          updatedAt: new Date()
        })
        .where(eq(worldRuntimeState.key, input.key));
      return;
    }

    await this.db.insert(worldRuntimeState).values({
      key: input.key,
      lastSettledAt: input.lastSettledAt,
      leaseOwner: input.leaseOwner,
      leaseUntil: input.leaseUntil
    });
  }

  async acquireLease(input: {
    key: string;
    ownerId: string;
    now: Date;
    leaseUntil: Date;
    initialLastSettledAt: Date;
  }): Promise<WorldRuntimeRecord | null> {
    const [row] = await this.db
      .insert(worldRuntimeState)
      .values({
        key: input.key,
        lastSettledAt: input.initialLastSettledAt,
        leaseOwner: input.ownerId,
        leaseUntil: input.leaseUntil
      })
      .onConflictDoUpdate({
        target: worldRuntimeState.key,
        set: {
          leaseOwner: input.ownerId,
          leaseUntil: input.leaseUntil,
          updatedAt: input.now
        },
        where: sql`${worldRuntimeState.leaseUntil} IS NULL OR ${worldRuntimeState.leaseUntil} <= ${input.now}`
      })
      .returning();

    return row
      ? {
          key: row.key,
          lastSettledAt: row.lastSettledAt,
          leaseOwner: row.leaseOwner,
          leaseUntil: row.leaseUntil
        }
      : null;
  }

  async saveProgress(input: {
    key: string;
    lastSettledAt: Date;
    leaseOwner: string;
    leaseUntil: Date;
  }): Promise<void> {
    await this.db
      .update(worldRuntimeState)
      .set({
        lastSettledAt: input.lastSettledAt,
        leaseOwner: input.leaseOwner,
        leaseUntil: input.leaseUntil,
        updatedAt: new Date()
      })
      .where(eq(worldRuntimeState.key, input.key));
  }

  async releaseLease(input: {
    key: string;
    ownerId: string;
    lastSettledAt: Date;
  }): Promise<void> {
    await this.db
      .update(worldRuntimeState)
      .set({
        lastSettledAt: input.lastSettledAt,
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: new Date()
      })
      .where(eq(worldRuntimeState.key, input.key));
  }
}
