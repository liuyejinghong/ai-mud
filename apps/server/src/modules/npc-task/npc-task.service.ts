import { FIRST_ITEMS, getItemById } from "@ai-mud/content";
import { addInventoryItem, formatMoney } from "@ai-mud/game-rules";
import type { ItemId, NpcTaskDto, NpcTaskNeedType } from "@ai-mud/shared";
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
  listNpcActors(): Promise<NpcActorRecord[]>;
  findNpcActor(actorId: string): Promise<NpcActorRecord | null>;
  updateNpcCopper(input: { actorId: string; copperBalance: number }): Promise<void>;
  listNpcInventory(actorId: string): Promise<NpcInventoryRecord[]>;
  setNpcInventoryItem(input: { actorId: string; itemId: ItemId; quantity: number }): Promise<void>;
  findCharacterByAccountId(accountId: string): Promise<CharacterRecord | null>;
  updateCharacterCopper(input: { characterId: string; copperBalance: number }): Promise<void>;
  listCharacterInventory(characterId: string): Promise<InventoryRecord[]>;
  setCharacterInventoryItem(input: {
    characterId: string;
    itemId: ItemId;
    quantity: number;
  }): Promise<void>;
  listBlockingTasksForNpc(actorId: string): Promise<NpcTaskRecord[]>;
  listTasksForCharacter(characterId: string): Promise<NpcTaskRecord[]>;
  findTask(taskId: string): Promise<NpcTaskRecord | null>;
  createTask(input: Parameters<NpcTaskRepository["createTask"]>[0]): Promise<NpcTaskRecord>;
  updateTask(input: Parameters<NpcTaskRepository["updateTask"]>[0]): Promise<void>;
}

interface TaskProposal {
  needType: NpcTaskNeedType;
  requestedItemId: ItemId;
  requestedQuantity: number;
  rewardCopper: number;
  title: string;
  description: string;
}

export interface NpcTaskCopywriterInput {
  actor: NpcActorRecord;
  needType: NpcTaskNeedType;
  requestedItemId: ItemId;
  requestedQuantity: number;
  rewardCopper: number;
  title: string;
  description: string;
  inventory: NpcInventoryRecord[];
  now: Date;
}

export interface NpcTaskCopywriterPort {
  polishTaskCopy(input: NpcTaskCopywriterInput): Promise<Pick<TaskProposal, "title" | "description">>;
}

export class NpcTaskService {
  constructor(
    private readonly repo: NpcTaskRepositoryPort,
    private readonly memory?: NpcTaskMemoryPort,
    private readonly copywriter?: NpcTaskCopywriterPort
  ) {}

  async syncOpenTasks(now: Date) {
    await this.expireDueTasks(now);
    const actors = await this.repo.listNpcActors();

    for (const actor of actors) {
      const blockingTasks = await this.repo.listBlockingTasksForNpc(actor.id);
      if (blockingTasks.length > 0) continue;

      const inventory = await this.repo.listNpcInventory(actor.id);
      const proposal = this.proposeTask(actor, inventory);
      if (!proposal) continue;

      if (actor.copperBalance < proposal.rewardCopper + NPC_COPPER_RESERVE) continue;
      const copy = await this.polishProposal(actor, inventory, proposal, now);

      await this.repo.updateNpcCopper({
        actorId: actor.id,
        copperBalance: actor.copperBalance - proposal.rewardCopper
      });
      await this.repo.createTask({
        npcActorId: actor.id,
        needType: proposal.needType,
        title: copy.title,
        description: copy.description,
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
    const character = await this.requireCharacter(accountId);
    const tasks = await this.repo.listTasksForCharacter(character.id);
    return Promise.all(tasks.map((task) => this.toDto(task)));
  }

  async acceptTask(accountId: string, taskId: string, now = new Date()): Promise<NpcTaskDto[]> {
    await this.expireDueTasks(now);
    const character = await this.requireCharacter(accountId);
    const task = await this.requireTask(taskId);

    if (task.status !== "open" || task.expiresAt.getTime() <= now.getTime()) {
      throw new NpcTaskServiceError("VALIDATION_ERROR", "这个任务已经不可接取。");
    }

    await this.repo.updateTask({
      taskId,
      status: "accepted",
      acceptedByCharacterId: character.id,
      acceptedAt: now
    });

    return this.listTasksForAccount(accountId, now);
  }

  async completeTask(accountId: string, taskId: string, now = new Date()): Promise<NpcTaskDto[]> {
    await this.expireDueTasks(now);
    const character = await this.requireCharacter(accountId);
    const task = await this.requireTask(taskId);

    if (
      task.status !== "accepted" ||
      task.acceptedByCharacterId !== character.id ||
      task.expiresAt.getTime() <= now.getTime()
    ) {
      throw new NpcTaskServiceError("VALIDATION_ERROR", "这个任务不能提交。");
    }

    const inventory = await this.repo.listCharacterInventory(character.id);
    const stack = inventory.find((item) => item.itemId === task.requestedItemId);
    if (!stack || stack.quantity < task.requestedQuantity) {
      throw new NpcTaskServiceError("VALIDATION_ERROR", "提交物品不足。");
    }

    const npcInventory = await this.repo.listNpcInventory(task.npcActorId);
    const nextNpcInventory = addInventoryItem(
      npcInventory.map((item) => ({ itemId: item.itemId as ItemId, quantity: item.quantity })),
      task.requestedItemId,
      task.requestedQuantity
    );
    const npcStack = nextNpcInventory.find((item) => item.itemId === task.requestedItemId);
    if (!npcStack) throw new Error("Failed to calculate NPC inventory stack");

    await this.repo.setCharacterInventoryItem({
      characterId: character.id,
      itemId: task.requestedItemId,
      quantity: stack.quantity - task.requestedQuantity
    });
    await this.repo.setNpcInventoryItem({
      actorId: task.npcActorId,
      itemId: task.requestedItemId,
      quantity: npcStack.quantity
    });
    await this.repo.updateCharacterCopper({
      characterId: character.id,
      copperBalance: character.copperBalance + task.escrowCopper
    });
    await this.repo.updateTask({
      taskId,
      status: "completed",
      completedAt: now
    });

    if (this.memory) {
      const item = getItemById(task.requestedItemId);
      await this.memory.recordSystemMemory({
        npcActorId: task.npcActorId,
        characterId: character.id,
        memoryKind: "task",
        importance: 4,
        occurredAt: now,
        sourceIds: [task.id],
        summary: `${character.name} 完成了任务「${task.title}」，交付 ${item?.name ?? task.requestedItemId} x${task.requestedQuantity}。`
      });
    }

    return this.listTasksForAccount(accountId, now);
  }

  async expireDueTasks(now: Date) {
    const actors = await this.repo.listNpcActors();

    for (const actor of actors) {
      const tasks = await this.repo.listBlockingTasksForNpc(actor.id);
      for (const task of tasks) {
        if (task.expiresAt.getTime() > now.getTime()) continue;
        await this.repo.updateNpcCopper({
          actorId: actor.id,
          copperBalance: actor.copperBalance + task.escrowCopper
        });
        await this.repo.updateTask({
          taskId: task.id,
          status: "expired",
          cancelledAt: now
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
        description: `${actor.name}的口粮已经见底，需要有人送来野莓维持今天的行动。`
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
          description: `${actor.name}缺少基础铁矿石，修理炉火和补强装备都会被拖慢。`
        };
      }
    }

    return null;
  }

  private async polishProposal(
    actor: NpcActorRecord,
    inventory: NpcInventoryRecord[],
    proposal: TaskProposal,
    now: Date
  ): Promise<Pick<TaskProposal, "title" | "description">> {
    if (!this.copywriter) return { title: proposal.title, description: proposal.description };

    try {
      const polished = await this.copywriter.polishTaskCopy({
        actor,
        needType: proposal.needType,
        requestedItemId: proposal.requestedItemId,
        requestedQuantity: proposal.requestedQuantity,
        rewardCopper: proposal.rewardCopper,
        title: proposal.title,
        description: proposal.description,
        inventory,
        now
      });

      if (!this.isValidTaskCopy(polished)) {
        return { title: proposal.title, description: proposal.description };
      }

      return {
        title: polished.title.trim(),
        description: polished.description.trim()
      };
    } catch {
      return { title: proposal.title, description: proposal.description };
    }
  }

  private isValidTaskCopy(value: Pick<TaskProposal, "title" | "description">) {
    const title = value.title.trim();
    const description = value.description.trim();
    return (
      title.length > 0 &&
      description.length > 0 &&
      [...title].length <= TASK_TITLE_MAX_CHARS &&
      [...description].length <= TASK_DESCRIPTION_MAX_CHARS
    );
  }

  private async requireCharacter(accountId: string) {
    const character = await this.repo.findCharacterByAccountId(accountId);
    if (!character) throw new NpcTaskServiceError("VALIDATION_ERROR", "角色不存在。");
    return character;
  }

  private async requireTask(taskId: string) {
    const task = await this.repo.findTask(taskId);
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
