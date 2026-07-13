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
import type { CopperLedgerWriter } from "../ledger/ledger.service.js";
import type { NpcActorRecord, NpcInventoryRecord } from "../npc/npc.service.js";
import type { NpcTaskRecord, NpcTaskRepository } from "./npc-task.repository.js";

const TASK_TTL_MS = 24 * 60 * 60 * 1000;
const FOOD_ITEM_ID = "wild_berry" as const;
const ORE_ITEM_ID = "iron_ore" as const;
const NPC_COPPER_RESERVE = 5;
const TASK_CANDIDATE_MAX_AGE_MS = 10 * 60 * 1000;
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
  findNpcActorForUpdate(actorId: string): Promise<NpcActorRecord | null>;
  hasBlockingTaskForNpc(actorId: string): Promise<boolean>;
  reserveNpcCopper(input: {
    actorId: string;
    amountCopper: number;
    reserveCopper: number;
  }): Promise<boolean>;
  incrementNpcCopper(input: { actorId: string; delta: number }): Promise<void>;
  listNpcInventory(actorId: string): Promise<NpcInventoryRecord[]>;
  findCharacterByAccountId(accountId: string): Promise<CharacterRecord | null>;
  incrementCharacterCopper(input: { characterId: string; delta: number }): Promise<void>;
  recordCopperTransfer?(input: Parameters<CopperLedgerWriter["recordCopperTransfer"]>[0]): Promise<void>;
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

export interface NpcTaskCandidate {
  npcActorId: string;
  needType: NpcTaskNeedType;
  requestedItemId: ItemId;
  requestedQuantity: number;
  rewardCopper: number;
  templateTitle: string;
  templateDescription: string;
  templateReason: string;
  observedAt: Date;
  observedActor?: NpcActorRecord;
  observedInventory?: NpcInventoryRecord[];
}

export interface NpcTaskPresentation {
  title: string;
  description: string;
  proposalReason: string;
  proposalSource: NpcTaskProposalSource;
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
    const candidates = await this.detectCandidates(now);
    for (const candidate of candidates) {
      const presentation = await this.presentCandidate(candidate);
      await this.commitCandidate(candidate, presentation, now);
    }
  }

  async detectCandidates(now: Date): Promise<NpcTaskCandidate[]> {
    const actors = await this.repo.listNpcActors();
    const candidates: NpcTaskCandidate[] = [];
    for (const actor of actors) {
      const blockingTasks = await this.repo.listBlockingTasksForNpc(actor.id);
      if (blockingTasks.some((task) => task.expiresAt.getTime() > now.getTime())) continue;

      const inventory = await this.repo.listNpcInventory(actor.id);
      const proposal = this.proposeTask(actor, inventory);
      if (!proposal) continue;

      const dueEscrowCopper = blockingTasks
        .filter((task) => task.expiresAt.getTime() <= now.getTime())
        .reduce((sum, task) => sum + task.escrowCopper, 0);
      const expectedActor = {
        ...actor,
        copperBalance: actor.copperBalance + dueEscrowCopper
      };
      if (expectedActor.copperBalance < proposal.rewardCopper + NPC_COPPER_RESERVE) continue;

      candidates.push({
        npcActorId: actor.id,
        needType: proposal.needType,
        requestedItemId: proposal.requestedItemId,
        requestedQuantity: proposal.requestedQuantity,
        rewardCopper: proposal.rewardCopper,
        templateTitle: proposal.title,
        templateDescription: proposal.description,
        templateReason: proposal.proposalReason,
        observedAt: new Date(now),
        observedActor: expectedActor,
        observedInventory: inventory.map((item) => ({ ...item }))
      });
    }

    return candidates;
  }

  async presentCandidate(candidate: NpcTaskCandidate): Promise<NpcTaskPresentation> {
    const proposal = this.proposalFromCandidate(candidate);
    const actor = candidate.observedActor ?? (await this.repo.findNpcActor(candidate.npcActorId));
    if (!actor) return this.templatePresentation(proposal);
    const inventory =
      candidate.observedInventory ?? (await this.repo.listNpcInventory(candidate.npcActorId));
    return this.presentProposal(actor, inventory, proposal, candidate.observedAt);
  }

  async commitCandidate(
    candidate: NpcTaskCandidate,
    presentation: NpcTaskPresentation,
    now: Date
  ): Promise<NpcTaskRecord | null> {
    try {
      return await this.repo.transaction(async (repo) => {
        await this.expireDueTasksInTransaction(repo, now);

        const actor = await repo.findNpcActorForUpdate(candidate.npcActorId);
        if (!actor || actor.status !== "active") return null;
        if (await repo.hasBlockingTaskForNpc(actor.id)) return null;

        const inventory = await repo.listNpcInventory(actor.id);
        const proposal = this.proposeTask(actor, inventory);
        if (!proposal || !this.matchesCandidate(candidate, proposal)) return null;

        const candidateAge = now.getTime() - candidate.observedAt.getTime();
        if (candidateAge < 0 || candidateAge > TASK_CANDIDATE_MAX_AGE_MS) return null;
        if (candidate.observedActor && !this.sameActorObservation(candidate.observedActor, actor)) {
          return null;
        }
        if (
          candidate.observedInventory &&
          !this.sameInventoryObservation(candidate.observedInventory, inventory)
        ) {
          return null;
        }

        const reserved = await repo.reserveNpcCopper({
          actorId: actor.id,
          amountCopper: proposal.rewardCopper,
          reserveCopper: NPC_COPPER_RESERVE
        });
        if (!reserved) return null;

        const task = await repo.createTask({
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
        await repo.recordCopperTransfer?.({
          operation: "task_escrow",
          fromBucket: "npc",
          fromEntityId: actor.id,
          toBucket: "escrow",
          toEntityId: task.id,
          amountCopper: proposal.rewardCopper,
          reason: "npc_task.escrow",
          metadata: {
            needType: proposal.needType,
            requestedItemId: proposal.requestedItemId,
            requestedQuantity: proposal.requestedQuantity
          },
          createdAt: now
        });
        return task;
      });
    } catch (error) {
      if (this.isActiveTaskUniqueConflict(error)) return null;
      throw error;
    }
  }

  async listTasksForAccount(accountId: string, now = new Date()): Promise<NpcTaskDto[]> {
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
      await repo.recordCopperTransfer?.({
        operation: "task_reward",
        fromBucket: "escrow",
        fromEntityId: task.id,
        toBucket: "player",
        toEntityId: character.id,
        amountCopper: task.escrowCopper,
        reason: "npc_task.reward",
        metadata: { npcActorId: task.npcActorId },
        createdAt: now
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
        await repo.recordCopperTransfer?.({
          operation: "task_refund",
          fromBucket: "escrow",
          fromEntityId: task.id,
          toBucket: "npc",
          toEntityId: actor.id,
          amountCopper: task.escrowCopper,
          reason: "npc_task.refund",
          metadata: { status: "expired" },
          createdAt: now
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

  private proposalFromCandidate(candidate: NpcTaskCandidate): TaskProposal {
    return {
      needType: candidate.needType,
      requestedItemId: candidate.requestedItemId,
      requestedQuantity: candidate.requestedQuantity,
      rewardCopper: candidate.rewardCopper,
      title: candidate.templateTitle,
      description: candidate.templateDescription,
      proposalReason: candidate.templateReason
    };
  }

  private matchesCandidate(candidate: NpcTaskCandidate, proposal: TaskProposal) {
    return (
      candidate.npcActorId === candidate.observedActor?.id ||
      candidate.observedActor === undefined
    ) &&
      candidate.needType === proposal.needType &&
      candidate.requestedItemId === proposal.requestedItemId &&
      candidate.requestedQuantity === proposal.requestedQuantity &&
      candidate.rewardCopper === proposal.rewardCopper &&
      candidate.templateTitle === proposal.title &&
      candidate.templateDescription === proposal.description &&
      candidate.templateReason === proposal.proposalReason;
  }

  private sameActorObservation(expected: NpcActorRecord, actual: NpcActorRecord) {
    return (
      expected.id === actual.id &&
      expected.actorType === actual.actorType &&
      expected.npcKey === actual.npcKey &&
      expected.name === actual.name &&
      expected.profession === actual.profession &&
      expected.currentLocation === actual.currentLocation &&
      JSON.stringify(expected.position) === JSON.stringify(actual.position) &&
      expected.copperBalance === actual.copperBalance &&
      expected.hunger === actual.hunger &&
      expected.lastHungerSettledAt.getTime() === actual.lastHungerSettledAt.getTime() &&
      expected.status === actual.status
    );
  }

  private sameInventoryObservation(
    expected: NpcInventoryRecord[],
    actual: NpcInventoryRecord[]
  ) {
    const normalize = (inventory: NpcInventoryRecord[]) =>
      inventory
        .map((item) => `${item.itemId}:${item.quantity}`)
        .sort()
        .join("|");
    return normalize(expected) === normalize(actual);
  }

  private isActiveTaskUniqueConflict(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const conflict = error as { code?: unknown; constraint?: unknown };
    return (
      conflict.code === "NPC_TASK_ACTIVE_CONFLICT" ||
      (conflict.code === "23505" &&
        conflict.constraint === "npc_tasks_one_active_per_npc_idx")
    );
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
