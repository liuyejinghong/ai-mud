import { eq } from "drizzle-orm";
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
}
