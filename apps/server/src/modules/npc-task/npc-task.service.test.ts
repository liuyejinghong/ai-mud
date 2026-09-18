import type { AiCallStatus, ItemId } from "@ai-mud/shared";
import { describe, expect, it } from "vitest";
import type { AssetMutationPort, AssetMutationTx } from "../ledger/asset-mutation.service.js";
import { ItemService } from "../item/item.service.js";
import type { CopperLedgerWriter } from "../ledger/ledger.service.js";
import type { CharacterRecord, InventoryRecord } from "../game/game.repository.js";
import type { NpcActorRecord, NpcInventoryRecord } from "../npc/npc.service.js";
import {
  NpcTaskService,
  type NpcTaskProposalInput,
  type NpcTaskRepositoryPort
} from "./npc-task.service.js";
import type {
  CreateNpcTaskInput,
  NpcTaskRecord,
  UpdateNpcTaskInput
} from "./npc-task.repository.js";

class ActiveNpcTaskConflictError extends Error {
  readonly code = "NPC_TASK_ACTIVE_CONFLICT";
}

class FakeNpcTaskRepo {
  actors = new Map<string, NpcActorRecord>();
  characters = new Map<string, CharacterRecord>();
  npcInventory = new Map<string, NpcInventoryRecord[]>();
  characterInventory = new Map<string, InventoryRecord[]>();
  tasks = new Map<string, NpcTaskRecord>();
  nextTask = 1;
  transactionCalls = 0;
  listNpcActorsCalls = 0;
  createTaskCalls = 0;
  npcCopperMutationCalls = 0;
  escrowCalls = 0;
  expireCalls = 0;
  failNextConditionalUpdate = false;
  failNextActiveTaskInsert = false;
  failNextEscrowLedger = false;
  assets: FakeAssets | null = null;
  ledger: FakeLedger | null = null;
  inTransaction = false;
  aiCalledInsideTransaction = false;

  async transaction<T>(
    operation: (repo: NpcTaskRepositoryPort, tx: AssetMutationTx) => Promise<T>
  ): Promise<T> {
    this.transactionCalls += 1;
    const snapshot = {
      actors: structuredClone(this.actors),
      characters: structuredClone(this.characters),
      npcInventory: structuredClone(this.npcInventory),
      characterInventory: structuredClone(this.characterInventory),
      tasks: structuredClone(this.tasks),
      nextTask: this.nextTask,
      createTaskCalls: this.createTaskCalls,
      npcCopperMutationCalls: this.npcCopperMutationCalls,
      escrowCalls: this.escrowCalls,
      expireCalls: this.expireCalls
    };
    this.inTransaction = true;
    try {
      return await operation(this, this as unknown as AssetMutationTx);
    } catch (error) {
      this.actors = snapshot.actors;
      this.characters = snapshot.characters;
      this.npcInventory = snapshot.npcInventory;
      this.characterInventory = snapshot.characterInventory;
      this.tasks = snapshot.tasks;
      this.nextTask = snapshot.nextTask;
      this.createTaskCalls = snapshot.createTaskCalls;
      this.npcCopperMutationCalls = snapshot.npcCopperMutationCalls;
      this.escrowCalls = snapshot.escrowCalls;
      this.expireCalls = snapshot.expireCalls;
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async listNpcActors() {
    this.listNpcActorsCalls += 1;
    return [...this.actors.values()];
  }

  async findNpcActor(actorId: string) {
    return this.actors.get(actorId) ?? null;
  }

  async findNpcActorForUpdate(actorId: string) {
    if (!this.inTransaction) throw new Error("actor lock requires transaction");
    return this.actors.get(actorId) ?? null;
  }

  async hasBlockingTaskForNpc(actorId: string) {
    return (await this.listBlockingTasksForNpc(actorId)).length > 0;
  }




  async listNpcInventory(actorId: string) {
    return [...(this.npcInventory.get(actorId) ?? [])];
  }

  async setNpcInventoryItem(input: { actorId: string; itemId: ItemId; quantity: number }) {
    const inventory = [...(this.npcInventory.get(input.actorId) ?? [])];
    const index = inventory.findIndex((item) => item.itemId === input.itemId);
    if (index >= 0) inventory[index] = { itemId: input.itemId, quantity: input.quantity };
    else inventory.push({ itemId: input.itemId, quantity: input.quantity });
    this.npcInventory.set(input.actorId, inventory);
  }

  async findCharacterByAccountId(accountId: string) {
    return [...this.characters.values()].find((character) => character.accountId === accountId) ?? null;
  }


  async listCharacterInventory(characterId: string) {
    return [...(this.characterInventory.get(characterId) ?? [])];
  }

  async setCharacterInventoryItem(input: {
    characterId: string;
    itemId: ItemId;
    quantity: number;
  }) {
    const inventory = [...(this.characterInventory.get(input.characterId) ?? [])];
    const index = inventory.findIndex((item) => item.itemId === input.itemId);
    if (index >= 0) inventory[index] = { itemId: input.itemId, quantity: input.quantity };
    else inventory.push({ itemId: input.itemId, quantity: input.quantity });
    this.characterInventory.set(input.characterId, inventory);
  }


  async listBlockingTasksForNpc(actorId: string) {
    return [...this.tasks.values()].filter(
      (task) =>
        task.npcActorId === actorId && (task.status === "open" || task.status === "accepted")
    );
  }

  async listTasksForCharacter(characterId: string) {
    return [...this.tasks.values()].filter(
      (task) =>
        task.status === "open" ||
        (task.status === "accepted" && task.acceptedByCharacterId === characterId)
    );
  }

  async findTask(taskId: string) {
    return this.tasks.get(taskId) ?? null;
  }

  async createTask(input: CreateNpcTaskInput): Promise<NpcTaskRecord> {
    this.createTaskCalls += 1;
    if (this.failNextActiveTaskInsert) {
      this.failNextActiveTaskInsert = false;
      throw new ActiveNpcTaskConflictError("active NPC task already exists");
    }
    const task: NpcTaskRecord = {
      id: `task-${this.nextTask++}`,
      npcActorId: input.npcActorId,
      needType: input.needType,
      status: "open",
      title: input.title,
      description: input.description,
      proposalSource: input.proposalSource,
      proposalReason: input.proposalReason,
      requestedItemId: input.requestedItemId,
      requestedQuantity: input.requestedQuantity,
      rewardCopper: input.rewardCopper,
      escrowCopper: input.escrowCopper,
      acceptedByCharacterId: null,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      completedAt: null,
      cancelledAt: null
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async updateTask(input: UpdateNpcTaskInput) {
    if (input.status === "expired") this.expireCalls += 1;
    const task = this.tasks.get(input.taskId);
    if (!task) throw new Error("task not found");
    const conditionalInput = input as UpdateNpcTaskInput & {
      expectedStatuses?: string[];
      expectedAcceptedByCharacterId?: string | null;
    };
    if (conditionalInput.expectedStatuses || conditionalInput.expectedAcceptedByCharacterId !== undefined) {
      if (this.failNextConditionalUpdate) {
        this.failNextConditionalUpdate = false;
        return false;
      }
      if (
        conditionalInput.expectedStatuses &&
        !conditionalInput.expectedStatuses.includes(task.status)
      ) {
        return false;
      }
      if (
        conditionalInput.expectedAcceptedByCharacterId !== undefined &&
        task.acceptedByCharacterId !== conditionalInput.expectedAcceptedByCharacterId
      ) {
        return false;
      }
    }
    this.tasks.set(input.taskId, {
      ...task,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.acceptedByCharacterId === undefined
        ? {}
        : { acceptedByCharacterId: input.acceptedByCharacterId }),
      ...(input.acceptedAt === undefined ? {} : { acceptedAt: input.acceptedAt }),
      ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
      ...(input.cancelledAt === undefined ? {} : { cancelledAt: input.cancelledAt })
    });
    return true;
  }
}


function makeNpcTaskPorts(repo: FakeNpcTaskRepo) {
  repo.assets ??= new FakeAssets(repo);
  repo.ledger ??= new FakeLedger(repo);
  return {
    assetsFor: () => repo.assets!,
    ledgerFor: () => repo.ledger!,
    itemsFor: (tx: unknown) => new ItemService(new FakeItemRepository(repo, tx) as never)
  };
}

class FakeAssets implements AssetMutationPort {
  constructor(private readonly repo: FakeNpcTaskRepo) {}

  async reserveNpcCopper(actorId: string, amountCopper: number, reserveCopper: number) {
    if (!this.repo.inTransaction) throw new Error("escrow reservation requires transaction");
    const actor = this.repo.actors.get(actorId);
    if (!actor || actor.copperBalance < amountCopper + reserveCopper) return false;
    this.repo.npcCopperMutationCalls += 1;
    this.repo.actors.set(actorId, {
      ...actor,
      copperBalance: actor.copperBalance - amountCopper
    });
    return true;
  }

  async creditNpcCopper(actorId: string, amount: number) {
    this.repo.npcCopperMutationCalls += 1;
    const actor = this.repo.actors.get(actorId);
    if (!actor) throw new Error("actor not found");
    this.repo.actors.set(actorId, { ...actor, copperBalance: actor.copperBalance + amount });
  }

  async creditCharacterCopper(characterId: string, amount: number) {
    const character = this.repo.characters.get(characterId);
    if (!character) throw new Error("character not found");
    this.repo.characters.set(characterId, {
      ...character,
      copperBalance: character.copperBalance + amount
    });
  }

  async debitCharacterCopperIfAvailable() {
    return false;
  }

  async debitNpcCopperIfAvailable() {
    return false;
  }

  async debitTreasuryIfAvailable() {
    return false;
  }

  async creditTreasury() {}

  async debitMarketStockIfAvailable() {
    return false;
  }

  async debitMarketStockAboveReserve() {
    return false;
  }

  async creditMarketStock() {}

  async findReceiptForUpdate() {
    return null;
  }

  async claimReceipt() {
    return true;
  }

  async saveReceiptResult() {}
}

class FakeLedger implements CopperLedgerWriter {
  async recordCopperTransfer(input: { operation: string }) {
    if (input.operation === "task_escrow") {
      this.repo.escrowCalls += 1;
      if (this.repo.failNextEscrowLedger) {
        this.repo.failNextEscrowLedger = false;
        throw new Error("ledger unavailable");
      }
    }
  }

  constructor(private readonly repo: FakeNpcTaskRepo) {}
}

class FakeItemRepository {
  constructor(
    private readonly repo: FakeNpcTaskRepo,
    private readonly tx: unknown
  ) {}

  async transaction<T>(operation: (repo: FakeItemRepository) => Promise<T>): Promise<T> {
    return operation(this);
  }

  async consumeStackable(input: {
    owner: { ownerType: string; ownerId: string | null };
    itemId: ItemId;
    quantity: number;
  }) {
    const map =
      input.owner.ownerType === "npc"
        ? this.repo.npcInventory
        : this.repo.characterInventory;
    const inventory = [...(map.get(input.owner.ownerId ?? "") ?? [])];
    const index = inventory.findIndex((item) => item.itemId === input.itemId);
    const stack = index >= 0 ? inventory[index] : null;
    if (!stack || stack.quantity < input.quantity) return false;
    inventory[index] = { itemId: input.itemId, quantity: stack.quantity - input.quantity };
    map.set(input.owner.ownerId ?? "", inventory);
    return true;
  }

  async writeLedger(_input: unknown) {}

  async grantStackable(input: {
    owner: { ownerType: string; ownerId: string | null };
    itemId: ItemId;
    quantity: number;
  }) {
    const map =
      input.owner.ownerType === "npc"
        ? this.repo.npcInventory
        : this.repo.characterInventory;
    const ownerId = input.owner.ownerId ?? "";
    const inventory = [...(map.get(ownerId) ?? [])];
    const index = inventory.findIndex((item) => item.itemId === input.itemId);
    if (index >= 0) {
      inventory[index] = { itemId: input.itemId, quantity: inventory[index]!.quantity + input.quantity };
    } else {
      inventory.push({ itemId: input.itemId, quantity: input.quantity });
    }
    map.set(ownerId, inventory);
  }
}

function actor(overrides: Partial<NpcActorRecord> = {}): NpcActorRecord {
  return {
    id: "npc-blacksmith",
    actorType: "npc",
    npcKey: "blackpine_blacksmith_borin",
    name: "伯林",
    profession: "blacksmith",
    currentLocation: "blackpine_outpost",
    position: null,
    copperBalance: 120,
    hunger: 5,
    lastHungerSettledAt: new Date("2026-07-02T00:00:00.000Z"),
    status: "active",
    ...overrides
  };
}

function character(): CharacterRecord {
  return {
    id: "character-1",
    accountId: "account-1",
      revision: 1,
    name: "阿岚",
    classId: "ranger",
    level: 1,
    xp: 0,
    hp: 100,
    maxHp: 100,
    copperBalance: 5,
    hunger: 5,
    lastHungerSettledAt: new Date("2026-07-02T00:00:00.000Z"),
    lastReliefClaimedAt: null,
    currentLocation: "blackpine_outpost",
    position: null,
    injuryUntil: null
  };
}

describe("NpcTaskService", () => {
  it("lists existing tasks without producing or mutating world state", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    repo.characters.set("character-1", character());
    const acceptedTask = await repo.createTask({
      npcActorId: "npc-blacksmith",
      needType: "ore_shortage",
      title: "炉火缺矿",
      description: "伯林缺少基础铁矿石。",
      proposalSource: "template",
      proposalReason: "基础铁矿石不足。",
      requestedItemId: "iron_ore",
      requestedQuantity: 3,
      rewardCopper: 36,
      escrowCopper: 36,
      createdAt: new Date("2026-07-02T08:00:00.000Z"),
      expiresAt: new Date("2026-07-03T08:00:00.000Z")
    });
    repo.tasks.set(acceptedTask.id, {
      ...acceptedTask,
      status: "accepted",
      acceptedByCharacterId: "character-1",
      acceptedAt: new Date("2026-07-02T08:05:00.000Z")
    });
    const completedTask = await repo.createTask({
      npcActorId: "npc-blacksmith",
      needType: "ore_shortage",
      title: "已经完成",
      description: "这个任务已经完成。",
      proposalSource: "template",
      proposalReason: "基础铁矿石不足。",
      requestedItemId: "iron_ore",
      requestedQuantity: 3,
      rewardCopper: 36,
      escrowCopper: 36,
      createdAt: new Date("2026-07-01T08:00:00.000Z"),
      expiresAt: new Date("2026-07-02T08:00:00.000Z")
    });
    repo.tasks.set(completedTask.id, {
      ...completedTask,
      status: "completed",
      acceptedByCharacterId: "character-1",
      acceptedAt: new Date("2026-07-01T08:05:00.000Z"),
      completedAt: new Date("2026-07-01T08:10:00.000Z")
    });
    repo.createTaskCalls = 0;
    let proposalCalls = 0;
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo), undefined, {
      proposeNpcTask: async () => {
        proposalCalls += 1;
        return {
          title: "不应生成",
          description: "列表读取不应生成任务。",
          npcReason: "列表读取不能调用 AI。",
          status: "success"
        };
      }
    });

    const tasks = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T09:00:00.000Z")
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: acceptedTask.id, status: "accepted" });
    expect(repo.transactionCalls).toBe(0);
    expect(repo.listNpcActorsCalls).toBe(0);
    expect(proposalCalls).toBe(0);
    expect(repo.createTaskCalls).toBe(0);
    expect(repo.npcCopperMutationCalls).toBe(0);
    expect(repo.escrowCalls).toBe(0);
    expect(repo.expireCalls).toBe(0);
  });

  it("detects rule-owned candidates through reads only", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    let proposalCalls = 0;
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo), undefined, {
      proposeNpcTask: async () => {
        proposalCalls += 1;
        throw new Error("detection must not call AI");
      }
    });
    const now = new Date("2026-07-02T08:00:00.000Z");

    const candidates = await service.detectCandidates(now);

    expect(candidates).toEqual([
      expect.objectContaining({
        npcActorId: "npc-blacksmith",
        needType: "ore_shortage",
        requestedItemId: "iron_ore",
        requestedQuantity: 3,
        rewardCopper: 36,
        templateTitle: "炉火缺矿",
        observedAt: now
      })
    ]);
    expect(repo.transactionCalls).toBe(0);
    expect(proposalCalls).toBe(0);
    expect(repo.createTaskCalls).toBe(0);
    expect(repo.npcCopperMutationCalls).toBe(0);
    expect(repo.escrowCalls).toBe(0);
  });

  it("presents a candidate with AI without opening a transaction", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor());
    repo.npcInventory.set("npc-blacksmith", []);
    let proposalCalls = 0;
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo), undefined, {
      proposeNpcTask: async () => {
        proposalCalls += 1;
        repo.aiCalledInsideTransaction ||= repo.inTransaction;
        return {
          title: "炉火等矿",
          description: "伯林把空矿箱推到你面前，请你带回三块基础铁矿石。",
          npcReason: "没有矿石，修理活会停下。",
          status: "success"
        };
      }
    });
    const [candidate] = await service.detectCandidates(new Date("2026-07-02T08:00:00.000Z"));
    const transactionCalls = repo.transactionCalls;

    const presentation = await service.presentCandidate(candidate!);

    expect(presentation).toMatchObject({
      title: "炉火等矿",
      proposalSource: "ai",
      proposalReason: "没有矿石，修理活会停下。"
    });
    expect(proposalCalls).toBe(1);
    expect(repo.transactionCalls).toBe(transactionCalls);
    expect(repo.aiCalledInsideTransaction).toBe(false);
  });

  it("keeps the sync wrapper AI callback outside its commit transaction", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor());
    repo.npcInventory.set("npc-blacksmith", []);
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo), undefined, {
      proposeNpcTask: async () => {
        repo.aiCalledInsideTransaction ||= repo.inTransaction;
        return {
          title: "炉火等矿",
          description: "伯林需要三块基础铁矿石。",
          npcReason: "矿箱空了。",
          status: "success"
        };
      }
    });

    await service.syncOpenTasks(new Date("2026-07-02T08:00:00.000Z"));

    expect(repo.aiCalledInsideTransaction).toBe(false);
    expect(repo.transactionCalls).toBe(1);
    expect(repo.tasks.size).toBe(1);
  });

  it("commits a fresh candidate in one short transaction", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo));
    const now = new Date("2026-07-02T08:00:00.000Z");
    const [candidate] = await service.detectCandidates(now);
    const presentation = await service.presentCandidate(candidate!);

    const task = await service.commitCandidate(candidate!, presentation, now);

    expect(task).toMatchObject({
      npcActorId: "npc-blacksmith",
      status: "open",
      requestedItemId: "iron_ore",
      requestedQuantity: 3,
      rewardCopper: 36,
      escrowCopper: 36
    });
    expect(repo.transactionCalls).toBe(1);
    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(84);
    expect(repo.tasks.size).toBe(1);
    expect(repo.escrowCalls).toBe(1);
  });

  it("returns null for a stale candidate without reserving escrow", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor());
    repo.npcInventory.set("npc-blacksmith", []);
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo));
    const observedAt = new Date("2026-07-02T08:00:00.000Z");
    const [candidate] = await service.detectCandidates(observedAt);
    const presentation = await service.presentCandidate(candidate!);

    const task = await service.commitCandidate(
      candidate!,
      presentation,
      new Date("2026-07-02T08:10:00.001Z")
    );

    expect(task).toBeNull();
    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(120);
    expect(repo.tasks.size).toBe(0);
    expect(repo.escrowCalls).toBe(0);
  });

  it.each([
    {
      race: "inventory changed after detection",
      arrange: async (repo: FakeNpcTaskRepo) => {
        repo.npcInventory.set("npc-blacksmith", [{ itemId: "iron_ore", quantity: 1 }]);
      }
    },
    {
      race: "balance changed after detection",
      arrange: async (repo: FakeNpcTaskRepo) => {
        repo.actors.set("npc-blacksmith", actor({ copperBalance: 119 }));
      }
    },
    {
      race: "another active task won after detection",
      arrange: async (repo: FakeNpcTaskRepo, now: Date) => {
        await repo.createTask({
          npcActorId: "npc-blacksmith",
          needType: "ore_shortage",
          title: "别处先贴出的任务",
          description: "另一个 worker 已经创建。",
          proposalSource: "template",
          proposalReason: "并发创建。",
          requestedItemId: "iron_ore",
          requestedQuantity: 3,
          rewardCopper: 36,
          escrowCopper: 36,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 86_400_000)
        });
      }
    },
    {
      race: "active-task unique insert conflicted",
      arrange: async (repo: FakeNpcTaskRepo) => {
        repo.failNextActiveTaskInsert = true;
      }
    }
  ])("returns null when $race and leaves no partial escrow", async ({ arrange }) => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo));
    const now = new Date("2026-07-02T08:00:00.000Z");
    const [candidate] = await service.detectCandidates(now);
    const presentation = await service.presentCandidate(candidate!);
    await arrange(repo, now);
    const tasksBeforeCommit = repo.tasks.size;
    const balanceBeforeCommit = repo.actors.get("npc-blacksmith")?.copperBalance;

    const task = await service.commitCandidate(candidate!, presentation, now);

    expect(task).toBeNull();
    expect(repo.tasks.size).toBe(tasksBeforeCommit);
    expect(repo.escrowCalls).toBe(0);
    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(balanceBeforeCommit);
  });

  it("rolls back task, escrow, ledger count and actor balance when ledger writing fails", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo));
    const now = new Date("2026-07-02T08:00:00.000Z");
    const [candidate] = await service.detectCandidates(now);
    const presentation = await service.presentCandidate(candidate!);
    repo.failNextEscrowLedger = true;

    await expect(service.commitCandidate(candidate!, presentation, now)).rejects.toThrow(
      "ledger unavailable"
    );

    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(120);
    expect(repo.tasks.size).toBe(0);
    expect(repo.createTaskCalls).toBe(0);
    expect(repo.npcCopperMutationCalls).toBe(0);
    expect(repo.escrowCalls).toBe(0);
  });

  it("creates ore shortage tasks from real NPC demand and escrows copper", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    repo.characters.set("character-1", character());
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo));
    const now = new Date("2026-07-02T08:00:00.000Z");

    await service.syncOpenTasks(now);
    const tasks = await service.listTasksForAccount("account-1", now);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.needType).toBe("ore_shortage");
    expect(tasks[0]?.requestedItem.itemId).toBe("iron_ore");
    expect(tasks[0]?.rewardCopper.totalCopper).toBe(36);
    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(84);
    expect([...repo.tasks.values()][0]?.escrowCopper).toBe(36);
    expect(repo.transactionCalls).toBeGreaterThan(0);
  });

  it("uses AI task proposal text without changing rule-owned item quantity or reward", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    repo.characters.set("character-1", character());
    const proposalInputs: NpcTaskProposalInput[] = [];
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo), undefined, {
      proposeNpcTask: async (input) => {
        proposalInputs.push(input);
        return {
          title: "炉火等矿",
          description: "伯林把空矿箱推到你面前，请你带回三块基础铁矿石。",
          npcReason: "没有矿石，哨站的修理活会拖到深夜。",
          status: "success" as AiCallStatus
        };
      }
    });
    const now = new Date("2026-07-02T08:00:00.000Z");

    await service.syncOpenTasks(now);
    const tasks = await service.listTasksForAccount("account-1", now);
    const created = [...repo.tasks.values()][0];

    expect(tasks[0]?.title).toBe("炉火等矿");
    expect(tasks[0]?.description).toContain("空矿箱");
    expect(tasks[0]?.proposalSource).toBe("ai");
    expect(tasks[0]?.proposalReason).toContain("修理活");
    expect(created?.requestedItemId).toBe("iron_ore");
    expect(created?.requestedQuantity).toBe(3);
    expect(created?.rewardCopper).toBe(36);
    expect(created?.escrowCopper).toBe(36);
    expect(created?.proposalSource).toBe("ai");
    expect(created?.proposalReason).toContain("修理活");
    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(84);
    expect(proposalInputs[0]?.rewardCopper).toBe(36);
    expect(proposalInputs[0]?.requestedItemId).toBe("iron_ore");
  });

  it("falls back to deterministic task proposal when AI proposal is invalid or unavailable", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    repo.characters.set("character-1", character());
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo), undefined, {
      proposeNpcTask: async () => ({
        title: "这个标题明显超过十八个中文字符所以必须回退",
        description: "",
        npcReason: "",
        status: "rejected" as AiCallStatus
      })
    });
    const now = new Date("2026-07-02T08:00:00.000Z");

    await service.syncOpenTasks(now);
    const tasks = await service.listTasksForAccount("account-1", now);

    expect(tasks[0]?.title).toBe("炉火缺矿");
    expect(tasks[0]?.description).toContain("缺少基础铁矿石");
    expect(tasks[0]?.proposalSource).toBe("template");
    expect(tasks[0]?.proposalReason).toContain("基础铁矿石");
  });

  it("does not create a task or call AI proposal when the NPC cannot escrow the reward", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 20 }));
    repo.characters.set("character-1", character());
    let proposalCalls = 0;
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo), undefined, {
      proposeNpcTask: async () => {
        proposalCalls += 1;
        return {
          title: "炉火等矿",
          description: "伯林需要矿。",
          npcReason: "矿箱空了。",
          status: "success"
        };
      }
    });
    const now = new Date("2026-07-02T08:00:00.000Z");

    await service.syncOpenTasks(now);
    const tasks = await service.listTasksForAccount("account-1", now);

    expect(tasks).toEqual([]);
    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(20);
    expect(proposalCalls).toBe(0);
  });

  it("accepts and completes tasks by transferring submitted goods and escrowed copper", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    repo.characters.set("character-1", character());
    repo.characterInventory.set("character-1", [{ itemId: "iron_ore", quantity: 3 }]);
    const memories: Array<{ summary: string; sourceIds?: string[] }> = [];
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo), {
      recordSystemMemory: async (input) => {
        memories.push(
          input.sourceIds
            ? { summary: input.summary, sourceIds: input.sourceIds }
            : { summary: input.summary }
        );
      }
    });
    const now = new Date("2026-07-02T08:00:00.000Z");

    await service.syncOpenTasks(now);
    const [task] = await service.listTasksForAccount("account-1", now);
    const acceptedTasks = await service.acceptTask(
      "account-1",
      task!.id,
      new Date("2026-07-02T08:05:00.000Z")
    );
    expect(acceptedTasks).toEqual([
      expect.objectContaining({
        id: task!.id,
        status: "accepted",
        acceptedByCharacterId: "character-1",
        acceptedAt: "2026-07-02T08:05:00.000Z",
        completedAt: null
      })
    ]);
    const tasks = await service.completeTask(
      "account-1",
      task!.id,
      new Date("2026-07-02T08:10:00.000Z")
    );

    expect(tasks).toEqual([]);
    expect(repo.characterInventory.get("character-1")).toEqual([
      { itemId: "iron_ore", quantity: 0 }
    ]);
    expect(repo.npcInventory.get("npc-blacksmith")).toEqual([
      { itemId: "iron_ore", quantity: 3 }
    ]);
    expect(repo.characters.get("character-1")?.copperBalance).toBe(41);
    expect(repo.tasks.get(task!.id)?.status).toBe("completed");
    expect(memories[0]?.summary).toContain("完成了任务");
    expect(memories[0]?.sourceIds).toEqual([task!.id]);
  });

  it("rejects task accept when the conditional status update loses the race", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.characters.set("character-1", character());
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo));
    const now = new Date("2026-07-02T08:00:00.000Z");
    await service.syncOpenTasks(now);
    const [task] = await service.listTasksForAccount("account-1", now);

    repo.failNextConditionalUpdate = true;

    await expect(
      service.acceptTask("account-1", task!.id, new Date("2026-07-02T08:05:00.000Z"))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(repo.tasks.get(task!.id)?.status).toBe("open");
  });

  it("does not double pay when task completion loses the conditional update race", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 84 }));
    repo.npcInventory.set("npc-blacksmith", []);
    repo.characters.set("character-1", character());
    repo.characterInventory.set("character-1", [{ itemId: "iron_ore", quantity: 3 }]);
    const now = new Date("2026-07-02T08:00:00.000Z");
    const task = await repo.createTask({
      npcActorId: "npc-blacksmith",
      needType: "ore_shortage",
      title: "炉火缺矿",
      description: "伯林缺少基础铁矿石。",
      proposalSource: "template",
      proposalReason: "基础铁矿石不足。",
      requestedItemId: "iron_ore",
      requestedQuantity: 3,
      rewardCopper: 36,
      escrowCopper: 36,
      createdAt: now,
      expiresAt: new Date("2026-07-03T08:00:00.000Z")
    });
    repo.tasks.set(task.id, {
      ...task,
      status: "accepted",
      acceptedByCharacterId: "character-1",
      acceptedAt: new Date("2026-07-02T08:05:00.000Z")
    });
    repo.failNextConditionalUpdate = true;
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo));

    await expect(
      service.completeTask("account-1", task.id, new Date("2026-07-02T08:10:00.000Z"))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(repo.characters.get("character-1")?.copperBalance).toBe(5);
    expect(repo.characterInventory.get("character-1")).toEqual([
      { itemId: "iron_ore", quantity: 3 }
    ]);
    expect(repo.npcInventory.get("npc-blacksmith")).toEqual([]);
    expect(repo.tasks.get(task.id)?.status).toBe("accepted");
  });

  it("expires tasks and can repost when the NPC still has the same demand", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.characters.set("character-1", character());
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo));
    const createdAt = new Date("2026-07-02T08:00:00.000Z");
    const refreshedAt = new Date("2026-07-03T08:00:01.000Z");

    await service.syncOpenTasks(createdAt);
    const [task] = await service.listTasksForAccount("account-1", createdAt);
    await service.syncOpenTasks(refreshedAt);
    const visibleTasks = await service.listTasksForAccount("account-1", refreshedAt);

    expect(repo.tasks.get(task!.id)?.status).toBe("expired");
    expect(visibleTasks).toHaveLength(1);
    expect(visibleTasks[0]?.id).not.toBe(task!.id);
    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(84);
  });

  it("does not refund escrow when expiring a task loses the conditional update race", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 84 }));
    repo.characters.set("character-1", character());
    const task = await repo.createTask({
      npcActorId: "npc-blacksmith",
      needType: "ore_shortage",
      title: "炉火缺矿",
      description: "伯林缺少基础铁矿石。",
      proposalSource: "template",
      proposalReason: "基础铁矿石不足。",
      requestedItemId: "iron_ore",
      requestedQuantity: 3,
      rewardCopper: 36,
      escrowCopper: 36,
      createdAt: new Date("2026-07-02T08:00:00.000Z"),
      expiresAt: new Date("2026-07-02T09:00:00.000Z")
    });
    repo.failNextConditionalUpdate = true;
    const service = new NpcTaskService(repo, makeNpcTaskPorts(repo));

    await service.expireDueTasks(new Date("2026-07-02T09:00:01.000Z"));

    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(84);
    expect(repo.tasks.get(task.id)?.status).toBe("open");
  });
});
