import { FIRST_ITEMS, getItemById } from "@ai-mud/content";
import { formatMoney } from "@ai-mud/game-rules";
import type {
  AiCallStatus,
  ItemId,
  NpcTaskDto,
  NpcTaskNeedType,
  NpcTaskProposalSource
} from "@ai-mud/shared";
import type { CharacterRecord, InventoryRecord } from "../game/game.repository.js";
import type { NpcActorRecord, NpcInventoryRecord } from "../npc/npc.service.js";
import type { NpcTaskRecord, NpcTaskRepository } from "./npc-task.repository.js";

const TASK_TTL_MS = 24 * 60 * 60 * 1000;
const FOOD_ITEM_ID = "wild_berry" as const;
const ORE_ITEM_ID = "iron_ore" as const;
const NPC_COPPER_RESERVE = 5;
const TASK_TITLE_MAX_CHARS = 18;
const TASK_DESCRIPTION_MAX_CHARS = 96;

export class NpcTaskServiceError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR",
    message: string
  ) {
    super(message);
  }
}

export interface NpcTaskMemoryPort {
  recordSystemMemory(input: {
    npcActorId: string;
    characterId: string | null;
    memoryKind: "task";
    summary: string;
    importance: number;
    occurredAt: Date;
    sourceIds?: string[];
  }): Promise<void>;
}

export interface NpcTaskRepositoryPort {
  transaction<T>(operation: (repo: NpcTaskRepositoryPort) => Promise<T>): Promise<T>;
  listNpcActors(): Promise<NpcActorRecord[]>;
  findNpcActor(actorId: string): Promise<NpcActorRecord | null>;
  incrementNpcCopper(input: { actorId: string; delta: number }): Promise<void>;
  listNpcInventory(actorId: string): Promise<NpcInventoryRecord[]>;
  findCharacterByAccountId(accountId: string): Promise<CharacterRecord | null>;
  incrementCharacterCopper(input: { characterId: string; delta: number }): Promise<void>;
  listCharacterInventory(characterId: string): Promise<InventoryRecord[]>;
  transferCharacterItemToNpc(input: {
    characterId: string;
    actorId: string;
    itemId: ItemId;
    quantity: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  listBlockingTasksForNpc(actorId: string): Promise<NpcTaskRecord[]>;
  listTasksForCharacter(characterId: string): Promise<NpcTaskRecord[]>;
  findTask(taskId: string): Promise<NpcTaskRecord | null>;
  createTask(input: Parameters<NpcTaskRepository["createTask"]>[0]): Promise<NpcTaskRecord>;
  updateTask(input: Parameters<NpcTaskRepository["updateTask"]>[0]): Promise<boolean>;
}

interface TaskProposal {
  needType: NpcTaskNeedType;
  requestedItemId: ItemId;
  requestedQuantity: number;
  rewardCopper: number;
  title: string;
  description: string;
  proposalReason: string;
}

export interface NpcTaskProposalInput {
  actor: NpcActorRecord;
  needType: NpcTaskNeedType;
  requestedItemId: ItemId;
  requestedQuantity: number;
  rewardCopper: number;
  title: string;
  description: string;
  proposalReason: string;
  inventory: NpcInventoryRecord[];
  now: Date;
}

export interface NpcTaskProposalPort {
  proposeNpcTask(input: NpcTaskProposalInput): Promise<
    Pick<TaskProposal, "title" | "description"> & { npcReason: string; status: AiCallStatus }
  >;
}

export class NpcTaskService {
  constructor(
    private readonly repo: NpcTaskRepositoryPort,
    private readonly memory?: NpcTaskMemoryPort,
    private readonly proposalPort?: NpcTaskProposalPort
  ) {}

  async syncOpenTasks(now: Date) {
    await this.repo.transaction((repo) => this.syncOpenTasksInTransaction(repo, now));
  }

  private async syncOpenTasksInTransaction(repo: NpcTaskRepositoryPort, now: Date) {
    await this.expireDueTasksInTransaction(repo, now);
    const actors = await repo.listNpcActors();

    for (const actor of actors) {
      const blockingTasks = await repo.listBlockingTasksForNpc(actor.id);
      if (blockingTasks.length > 0) continue;

      const inventory = await repo.listNpcInventory(actor.id);
      const proposal = this.proposeTask(actor, inventory);
      if (!proposal) continue;

      if (actor.copperBalance < proposal.rewardCopper + NPC_COPPER_RESERVE) continue;
      const presentation = await this.presentProposal(actor, inventory, proposal, now);

      await repo.incrementNpcCopper({
        actorId: actor.id,
        delta: -proposal.rewardCopper
      });
      await repo.createTask({
        npcActorId: actor.id,
        needType: proposal.needType,
        title: presentation.title,
        description: presentation.description,
        proposalSource: presentation.proposalSource,
        proposalReason: presentation.proposalReason,
        requestedItemId: proposal.requestedItemId,
        requestedQuantity: proposal.requestedQuantity,
        rewardCopper: proposal.rewardCopper,
        escrowCopper: proposal.rewardCopper,
        createdAt: now,
        expiresAt: new Date(now.getTime() + TASK_TTL_MS)
      });
    }
  }

  async listTasksForAccount(accountId: string, now = new Date()): Promise<NpcTaskDto[]> {
    await this.syncOpenTasks(now);
    const character = await this.requireCharacter(this.repo, accountId);
    const tasks = await this.repo.listTasksForCharacter(character.id);
    return Promise.all(tasks.map((task) => this.toDto(task)));
  }

  async acceptTask(accountId: string, taskId: string, now = new Date()): Promise<NpcTaskDto[]> {
    await this.repo.transaction(async (repo) => {
      await this.expireDueTasksInTransaction(repo, now);
      const character = await this.requireCharacter(repo, accountId);
      const task = await this.requireTask(repo, taskId);

      if (task.status !== "open" || task.expiresAt.getTime() <= now.getTime()) {
        throw new NpcTaskServiceError("VALIDATION_ERROR", "这个任务已经不可接取。");
      }

      const updated = await repo.updateTask({
        taskId,
        expectedStatuses: ["open"],
        status: "accepted",
        acceptedByCharacterId: character.id,
        acceptedAt: now
      });
      if (!updated) {
        throw new NpcTaskServiceError("VALIDATION_ERROR", "这个任务已经不可接取。");
      }
    });

    return this.listTasksForAccount(accountId, now);
  }

  async completeTask(accountId: string, taskId: string, now = new Date()): Promise<NpcTaskDto[]> {
    const completedMemory = await this.repo.transaction(async (repo) => {
      await this.expireDueTasksInTransaction(repo, now);
      const character = await this.requireCharacter(repo, accountId);
      const task = await this.requireTask(repo, taskId);

      if (
        task.status !== "accepted" ||
        task.acceptedByCharacterId !== character.id ||
        task.expiresAt.getTime() <= now.getTime()
      ) {
        throw new NpcTaskServiceError("VALIDATION_ERROR", "这个任务不能提交。");
      }

      const inventory = await repo.listCharacterInventory(character.id);
      const stack = inventory.find((item) => item.itemId === task.requestedItemId);
      if (!stack || stack.quantity < task.requestedQuantity) {
        throw new NpcTaskServiceError("VALIDATION_ERROR", "提交物品不足。");
      }

      const updated = await repo.updateTask({
        taskId,
        expectedStatuses: ["accepted"],
        expectedAcceptedByCharacterId: character.id,
        status: "completed",
        completedAt: now
      });
      if (!updated) {
        throw new NpcTaskServiceError("VALIDATION_ERROR", "这个任务不能提交。");
      }

      await repo.transferCharacterItemToNpc({
        characterId: character.id,
        actorId: task.npcActorId,
        itemId: task.requestedItemId,
        quantity: task.requestedQuantity,
        reason: "npc_task.complete",
        metadata: { taskId: task.id }
      });
      await repo.incrementCharacterCopper({
        characterId: character.id,
        delta: task.escrowCopper
      });

      return { character, task };
    });

    if (this.memory) {
      const item = getItemById(completedMemory.task.requestedItemId);
      await this.memory.recordSystemMemory({
        npcActorId: completedMemory.task.npcActorId,
        characterId: completedMemory.character.id,
        memoryKind: "task",
        importance: 4,
        occurredAt: now,
        sourceIds: [completedMemory.task.id],
        summary: `${completedMemory.character.name} 完成了任务「${completedMemory.task.title}」，交付 ${item?.name ?? completedMemory.task.requestedItemId} x${completedMemory.task.requestedQuantity}。`
      });
    }

    return this.listTasksForAccount(accountId, now);
  }

  async expireDueTasks(now: Date) {
    await this.repo.transaction((repo) => this.expireDueTasksInTransaction(repo, now));
  }

  private async expireDueTasksInTransaction(repo: NpcTaskRepositoryPort, now: Date) {
    const actors = await repo.listNpcActors();

    for (const actor of actors) {
      const tasks = await repo.listBlockingTasksForNpc(actor.id);
      for (const task of tasks) {
        if (task.expiresAt.getTime() > now.getTime()) continue;
        const updated = await repo.updateTask({
          taskId: task.id,
          expectedStatuses: ["open", "accepted"],
          status: "expired",
          cancelledAt: now
        });
        if (!updated) continue;
        await repo.incrementNpcCopper({
          actorId: actor.id,
          delta: task.escrowCopper
        });
      }
    }
  }

  private proposeTask(actor: NpcActorRecord, inventory: NpcInventoryRecord[]): TaskProposal | null {
    const foodCount = inventory
      .filter((item) => FIRST_ITEMS.some((definition) => definition.id === item.itemId && definition.category === "food"))
      .reduce((sum, item) => sum + item.quantity, 0);
    if (actor.hunger <= 2 && foodCount === 0) {
      return {
        needType: "food_shortage",
        requestedItemId: FOOD_ITEM_ID,
        requestedQuantity: 2,
        rewardCopper: 16,
        title: `${actor.name}的空粮袋`,
        description: `${actor.name}的口粮已经见底，需要有人送来野莓维持今天的行动。`,
        proposalReason: `${actor.name}缺少食物，今天的行动会受影响。`
      };
    }

    if (actor.profession === "blacksmith") {
      const oreCount = inventory.find((item) => item.itemId === ORE_ITEM_ID)?.quantity ?? 0;
      if (oreCount < 3) {
        return {
          needType: "ore_shortage",
          requestedItemId: ORE_ITEM_ID,
          requestedQuantity: 3,
          rewardCopper: 36,
          title: "炉火缺矿",
          description: `${actor.name}缺少基础铁矿石，修理炉火和补强装备都会被拖慢。`,
          proposalReason: "基础铁矿石不足，修理炉火和补强装备都会被拖慢。"
        };
      }
    }

    return null;
  }

  private async presentProposal(
    actor: NpcActorRecord,
    inventory: NpcInventoryRecord[],
    proposal: TaskProposal,
    now: Date
  ): Promise<Pick<TaskProposal, "title" | "description" | "proposalReason"> & { proposalSource: NpcTaskProposalSource }> {
    if (!this.proposalPort) return this.templatePresentation(proposal);

    try {
      const aiProposal = await this.proposalPort.proposeNpcTask({
        actor,
        needType: proposal.needType,
        requestedItemId: proposal.requestedItemId,
        requestedQuantity: proposal.requestedQuantity,
        rewardCopper: proposal.rewardCopper,
        title: proposal.title,
        description: proposal.description,
        proposalReason: proposal.proposalReason,
        inventory,
        now
      });

      if (aiProposal.status !== "success" || !this.isValidTaskPresentation(aiProposal)) {
        return this.templatePresentation(proposal);
      }

      return {
        title: aiProposal.title.trim(),
        description: aiProposal.description.trim(),
        proposalReason: aiProposal.npcReason.trim(),
        proposalSource: "ai"
      };
    } catch {
      return this.templatePresentation(proposal);
    }
  }

  private isValidTaskPresentation(value: Pick<TaskProposal, "title" | "description"> & { npcReason: string }) {
    const title = value.title.trim();
    const description = value.description.trim();
    const proposalReason = value.npcReason.trim();
    return (
      title.length > 0 &&
      description.length > 0 &&
      proposalReason.length > 0 &&
      [...title].length <= TASK_TITLE_MAX_CHARS &&
      [...description].length <= TASK_DESCRIPTION_MAX_CHARS &&
      [...proposalReason].length <= 72
    );
  }

  private templatePresentation(proposal: TaskProposal) {
    return {
      title: proposal.title,
      description: proposal.description,
      proposalReason: proposal.proposalReason,
      proposalSource: "template" as const
    };
  }

  private async requireCharacter(repo: NpcTaskRepositoryPort, accountId: string) {
    const character = await repo.findCharacterByAccountId(accountId);
    if (!character) throw new NpcTaskServiceError("VALIDATION_ERROR", "角色不存在。");
    return character;
  }

  private async requireTask(repo: NpcTaskRepositoryPort, taskId: string) {
    const task = await repo.findTask(taskId);
    if (!task) throw new NpcTaskServiceError("VALIDATION_ERROR", "任务不存在。");
    return task;
  }

  private async toDto(task: NpcTaskRecord): Promise<NpcTaskDto> {
    const actor = await this.repo.findNpcActor(task.npcActorId);
    const item = getItemById(task.requestedItemId);

    return {
      id: task.id,
      npcActorId: task.npcActorId,
      npcName: actor?.name ?? "未知 NPC",
      needType: task.needType,
      status: task.status,
      title: task.title,
      description: task.description,
      proposalSource: task.proposalSource,
      proposalReason: task.proposalReason,
      requestedItem: {
        itemId: task.requestedItemId,
        name: item?.name ?? task.requestedItemId,
        quantity: task.requestedQuantity
      },
      rewardCopper: formatMoney(task.rewardCopper),
      acceptedByCharacterId: task.acceptedByCharacterId,
      expiresAt: task.expiresAt.toISOString(),
      createdAt: task.createdAt.toISOString(),
      acceptedAt: task.acceptedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null
    };
  }
}
