import type { AiCallStatus, ItemId } from "@ai-mud/shared";
import { describe, expect, it } from "vitest";
import type { CharacterRecord, InventoryRecord } from "../game/game.repository.js";
import type { NpcActorRecord, NpcInventoryRecord } from "../npc/npc.service.js";
import { NpcTaskService, type NpcTaskProposalInput } from "./npc-task.service.js";
import type {
  CreateNpcTaskInput,
  NpcTaskRecord,
  UpdateNpcTaskInput
} from "./npc-task.repository.js";

class FakeNpcTaskRepo {
  actors = new Map<string, NpcActorRecord>();
  characters = new Map<string, CharacterRecord>();
  npcInventory = new Map<string, NpcInventoryRecord[]>();
  characterInventory = new Map<string, InventoryRecord[]>();
  tasks = new Map<string, NpcTaskRecord>();
  nextTask = 1;
  transactionCalls = 0;
  failNextConditionalUpdate = false;

  async transaction<T>(operation: (repo: FakeNpcTaskRepo) => Promise<T>) {
    this.transactionCalls += 1;
    return operation(this);
  }

  async listNpcActors() {
    return [...this.actors.values()];
  }

  async findNpcActor(actorId: string) {
    return this.actors.get(actorId) ?? null;
  }

  async incrementNpcCopper(input: { actorId: string; delta: number }) {
    const actor = this.actors.get(input.actorId);
    if (!actor) throw new Error("actor not found");
    this.actors.set(input.actorId, { ...actor, copperBalance: actor.copperBalance + input.delta });
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

  async incrementCharacterCopper(input: { characterId: string; delta: number }) {
    const character = this.characters.get(input.characterId);
    if (!character) throw new Error("character not found");
    this.characters.set(input.characterId, {
      ...character,
      copperBalance: character.copperBalance + input.delta
    });
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

  async transferCharacterItemToNpc(input: {
    characterId: string;
    actorId: string;
    itemId: ItemId;
    quantity: number;
  }) {
    const characterInventory = [...(this.characterInventory.get(input.characterId) ?? [])];
    const characterIndex = characterInventory.findIndex((item) => item.itemId === input.itemId);
    const characterStack = characterIndex >= 0 ? characterInventory[characterIndex] : null;
    if (!characterStack || characterStack.quantity < input.quantity) {
      throw new Error("物品数量不足。");
    }

    characterInventory[characterIndex] = {
      itemId: input.itemId,
      quantity: characterStack.quantity - input.quantity
    };
    this.characterInventory.set(input.characterId, characterInventory);

    const npcInventory = [...(this.npcInventory.get(input.actorId) ?? [])];
    const npcIndex = npcInventory.findIndex((item) => item.itemId === input.itemId);
    if (npcIndex >= 0) {
      npcInventory[npcIndex] = {
        itemId: input.itemId,
        quantity: npcInventory[npcIndex]!.quantity + input.quantity
      };
    } else {
      npcInventory.push({ itemId: input.itemId, quantity: input.quantity });
    }
    this.npcInventory.set(input.actorId, npcInventory);
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

  async createTask(input: CreateNpcTaskInput) {
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
    name: "阿岚",
    classId: "ranger",
    level: 1,
    xp: 0,
    hp: 100,
    maxHp: 100,
    copperBalance: 5,
    hunger: 5,
    lastHungerSettledAt: new Date("2026-07-02T00:00:00.000Z"),
    currentLocation: "blackpine_outpost",
    position: null,
    injuryUntil: null
  };
}

describe("NpcTaskService", () => {
  it("creates ore shortage tasks from real NPC demand and escrows copper", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    repo.characters.set("character-1", character());
    const service = new NpcTaskService(repo);

    const tasks = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );

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
    const service = new NpcTaskService(repo, undefined, {
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

    const tasks = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );
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
    const service = new NpcTaskService(repo, undefined, {
      proposeNpcTask: async () => ({
        title: "这个标题明显超过十八个中文字符所以必须回退",
        description: "",
        npcReason: "",
        status: "rejected" as AiCallStatus
      })
    });

    const tasks = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );

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
    const service = new NpcTaskService(repo, undefined, {
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

    const tasks = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );

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
    const service = new NpcTaskService(repo, {
      recordSystemMemory: async (input) => {
        memories.push(
          input.sourceIds
            ? { summary: input.summary, sourceIds: input.sourceIds }
            : { summary: input.summary }
        );
      }
    });

    const [task] = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );
    await service.acceptTask("account-1", task!.id, new Date("2026-07-02T08:05:00.000Z"));
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
    const service = new NpcTaskService(repo);
    const [task] = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );

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
    const service = new NpcTaskService(repo);

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
    const service = new NpcTaskService(repo);

    const [task] = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );
    const visibleTasks = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-03T08:00:01.000Z")
    );

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
    const service = new NpcTaskService(repo);

    await service.expireDueTasks(new Date("2026-07-02T09:00:01.000Z"));

    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(84);
    expect(repo.tasks.get(task.id)?.status).toBe("open");
  });
});
