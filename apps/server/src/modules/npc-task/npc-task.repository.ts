import type {
  ItemId,
  NpcTaskNeedType,
  NpcTaskProposalSource,
  NpcTaskStatus
} from "@ai-mud/shared";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { characterItems, characters, npcItems, npcTasks, worldActors } from "../../db/schema.js";
import type { CharacterRecord, InventoryRecord } from "../game/game.repository.js";
import { serializeHunger } from "../game/game.repository.js";
import type { AssetMutationTx } from "../ledger/asset-mutation.service.js";
import type { NpcActorRecord, NpcInventoryRecord } from "../npc/npc.service.js";

type NpcTaskDb = Pick<Db, "insert" | "select" | "update"> & { transaction?: Db["transaction"] };

export interface NpcTaskRecord {
  id: string;
  npcActorId: string;
  needType: NpcTaskNeedType;
  status: NpcTaskStatus;
  title: string;
  description: string;
  proposalSource: NpcTaskProposalSource;
  proposalReason: string | null;
  requestedItemId: ItemId;
  requestedQuantity: number;
  rewardCopper: number;
  escrowCopper: number;
  acceptedByCharacterId: string | null;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

export interface CreateNpcTaskInput {
  npcActorId: string;
  needType: NpcTaskNeedType;
  title: string;
  description: string;
  proposalSource: NpcTaskProposalSource;
  proposalReason: string | null;
  requestedItemId: ItemId;
  requestedQuantity: number;
  rewardCopper: number;
  escrowCopper: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface UpdateNpcTaskInput {
  taskId: string;
  expectedStatuses?: NpcTaskStatus[];
  expectedAcceptedByCharacterId?: string | null;
  status?: NpcTaskStatus;
  acceptedByCharacterId?: string | null;
  acceptedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
}

function toNpcActor(row: typeof worldActors.$inferSelect): NpcActorRecord {
  return {
    id: row.id,
    actorType: "npc",
    npcKey: row.npcKey ?? "",
    name: row.name,
    profession: row.profession,
    currentLocation: row.currentLocation,
    position:
      typeof row.position === "object" && row.position !== null
        ? (row.position as NpcActorRecord["position"])
        : null,
    copperBalance: row.copperBalance,
    hunger: serializeHunger(row.hunger),
    lastHungerSettledAt: row.lastHungerSettledAt,
    status: row.status
  };
}

function toCharacter(row: typeof characters.$inferSelect): CharacterRecord {
  return {
      revision: row.revision,
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    classId: row.classId,
    level: row.level,
    xp: row.xp,
    hp: row.hp,
    maxHp: row.maxHp,
    copperBalance: row.copperBalance,
    hunger: serializeHunger(row.hunger),
    lastHungerSettledAt: row.lastHungerSettledAt,
    lastReliefClaimedAt: row.lastReliefClaimedAt,
    currentLocation: row.currentLocation,
    position:
      typeof row.position === "object" && row.position !== null
        ? (row.position as CharacterRecord["position"])
        : null,
    injuryUntil: row.injuryUntil
  };
}

function toTask(row: typeof npcTasks.$inferSelect): NpcTaskRecord {
  return {
    id: row.id,
    npcActorId: row.npcActorId,
    needType: row.needType as NpcTaskNeedType,
    status: row.status as NpcTaskStatus,
    title: row.title,
    description: row.description,
    proposalSource: row.proposalSource as NpcTaskProposalSource,
    proposalReason: row.proposalReason,
    requestedItemId: row.requestedItemId as ItemId,
    requestedQuantity: row.requestedQuantity,
    rewardCopper: row.rewardCopper,
    escrowCopper: row.escrowCopper,
    acceptedByCharacterId: row.acceptedByCharacterId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt
  };
}

export class NpcTaskRepository {
  constructor(private readonly db: NpcTaskDb) {}

  async transaction<T>(
    operation: (repo: NpcTaskRepository, tx: AssetMutationTx) => Promise<T>
  ): Promise<T> {
    if (!this.db.transaction) return operation(this, this.db as unknown as AssetMutationTx);
    return this.db.transaction(async (tx) =>
      operation(new NpcTaskRepository(tx), tx as unknown as AssetMutationTx)
    );
  }

  async listNpcActors(): Promise<NpcActorRecord[]> {
    const rows = await this.db
      .select()
      .from(worldActors)
      .where(and(eq(worldActors.actorType, "npc"), eq(worldActors.status, "active")));
    return rows.map(toNpcActor);
  }

  async findNpcActor(actorId: string): Promise<NpcActorRecord | null> {
    const [row] = await this.db
      .select()
      .from(worldActors)
      .where(eq(worldActors.id, actorId))
      .limit(1);
    return row ? toNpcActor(row) : null;
  }

  async findNpcActorForUpdate(actorId: string): Promise<NpcActorRecord | null> {
    const [row] = await this.db
      .select()
      .from(worldActors)
      .where(and(eq(worldActors.id, actorId), eq(worldActors.actorType, "npc")))
      .limit(1)
      .for("update");
    return row ? toNpcActor(row) : null;
  }

  async hasBlockingTaskForNpc(actorId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: npcTasks.id })
      .from(npcTasks)
      .where(
        and(
          eq(npcTasks.npcActorId, actorId),
          or(eq(npcTasks.status, "open"), eq(npcTasks.status, "accepted"))
        )
      )
      .limit(1);
    return Boolean(row);
  }



  async listNpcInventory(actorId: string): Promise<NpcInventoryRecord[]> {
    const rows = await this.db
      .select({ itemId: npcItems.itemId, quantity: npcItems.quantity })
      .from(npcItems)
      .where(eq(npcItems.actorId, actorId));
    return rows;
  }

  async findCharacterByAccountId(accountId: string): Promise<CharacterRecord | null> {
    const [row] = await this.db
      .select()
      .from(characters)
      .where(eq(characters.accountId, accountId))
      .limit(1);
    return row ? toCharacter(row) : null;
  }



  async listCharacterInventory(characterId: string): Promise<InventoryRecord[]> {
    const rows = await this.db
      .select({ itemId: characterItems.itemId, quantity: characterItems.quantity })
      .from(characterItems)
      .where(eq(characterItems.characterId, characterId));

    return rows.map((row) => ({ itemId: row.itemId as ItemId, quantity: row.quantity }));
  }


  async listBlockingTasksForNpc(actorId: string): Promise<NpcTaskRecord[]> {
    const rows = await this.db
      .select()
      .from(npcTasks)
      .where(
        and(
          eq(npcTasks.npcActorId, actorId),
          or(eq(npcTasks.status, "open"), eq(npcTasks.status, "accepted"))
        )
      );
    return rows.map(toTask);
  }

  async listTasksForCharacter(characterId: string): Promise<NpcTaskRecord[]> {
    const rows = await this.db
      .select()
      .from(npcTasks)
      .where(
        or(
          eq(npcTasks.status, "open"),
          and(eq(npcTasks.status, "accepted"), eq(npcTasks.acceptedByCharacterId, characterId))
        )
      )
      .orderBy(desc(npcTasks.createdAt));
    return rows.map(toTask);
  }

  async findTask(taskId: string): Promise<NpcTaskRecord | null> {
    const [row] = await this.db.select().from(npcTasks).where(eq(npcTasks.id, taskId)).limit(1);
    return row ? toTask(row) : null;
  }

  async createTask(input: CreateNpcTaskInput): Promise<NpcTaskRecord> {
    const [row] = await this.db
      .insert(npcTasks)
      .values({
        npcActorId: input.npcActorId,
        needType: input.needType,
        title: input.title,
        description: input.description,
        proposalSource: input.proposalSource,
        proposalReason: input.proposalReason,
        requestedItemId: input.requestedItemId,
        requestedQuantity: input.requestedQuantity,
        rewardCopper: input.rewardCopper,
        escrowCopper: input.escrowCopper,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt
      })
      .returning();

    if (!row) throw new Error("Failed to create NPC task");
    return toTask(row);
  }

  async updateTask(input: UpdateNpcTaskInput): Promise<boolean> {
    const predicates = [eq(npcTasks.id, input.taskId)];
    if (input.expectedStatuses) {
      predicates.push(inArray(npcTasks.status, input.expectedStatuses));
    }
    if (input.expectedAcceptedByCharacterId !== undefined) {
      predicates.push(
        input.expectedAcceptedByCharacterId === null
          ? isNull(npcTasks.acceptedByCharacterId)
          : eq(npcTasks.acceptedByCharacterId, input.expectedAcceptedByCharacterId)
      );
    }

    const rows = await this.db
      .update(npcTasks)
      .set({
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.acceptedByCharacterId === undefined
          ? {}
          : { acceptedByCharacterId: input.acceptedByCharacterId }),
        ...(input.acceptedAt === undefined ? {} : { acceptedAt: input.acceptedAt }),
        ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
        ...(input.cancelledAt === undefined ? {} : { cancelledAt: input.cancelledAt }),
        updatedAt: new Date()
      })
      .where(and(...predicates))
      .returning({ id: npcTasks.id });

    return rows.length > 0;
  }
}
