import type { ItemId } from "@ai-mud/shared";
import { describe, expect, it } from "vitest";
import type { CharacterRecord, InventoryRecord } from "../game/game.repository.js";
import type { NpcActorRecord, NpcInventoryRecord } from "../npc/npc.service.js";
import { NpcTaskService, type NpcTaskCopywriterInput } from "./npc-task.service.js";
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

  async listNpcActors() {
    return [...this.actors.values()];
  }

  async findNpcActor(actorId: string) {
    return this.actors.get(actorId) ?? null;
  }

  async updateNpcCopper(input: { actorId: string; copperBalance: number }) {
    const actor = this.actors.get(input.actorId);
    if (!actor) throw new Error("actor not found");
    this.actors.set(input.actorId, { ...actor, copperBalance: input.copperBalance });
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

  async updateCharacterCopper(input: { characterId: string; copperBalance: number }) {
    const character = this.characters.get(input.characterId);
    if (!character) throw new Error("character not found");
    this.characters.set(input.characterId, {
      ...character,
      copperBalance: input.copperBalance
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
  });

  it("uses AI-polished task copy without changing rule-owned item quantity or reward", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    repo.characters.set("character-1", character());
    const copyInputs: NpcTaskCopywriterInput[] = [];
    const service = new NpcTaskService(repo, undefined, {
      polishTaskCopy: async (input) => {
        copyInputs.push(input);
        return {
          title: "炉火待矿",
          description: "伯林把空矿箱推到炉边，催你带回基础铁矿石，免得修理活全压到夜里。"
        };
      }
    });

    const tasks = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );
    const created = [...repo.tasks.values()][0];

    expect(tasks[0]?.title).toBe("炉火待矿");
    expect(tasks[0]?.description).toContain("空矿箱");
    expect(created?.requestedItemId).toBe("iron_ore");
    expect(created?.requestedQuantity).toBe(3);
    expect(created?.rewardCopper).toBe(36);
    expect(created?.escrowCopper).toBe(36);
    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(84);
    expect(copyInputs[0]?.rewardCopper).toBe(36);
    expect(copyInputs[0]?.requestedItemId).toBe("iron_ore");
  });

  it("falls back to deterministic task copy when AI copy is invalid or unavailable", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 120 }));
    repo.npcInventory.set("npc-blacksmith", []);
    repo.characters.set("character-1", character());
    const service = new NpcTaskService(repo, undefined, {
      polishTaskCopy: async () => ({
        title: "这个标题明显超过十八个中文字符所以必须回退",
        description: ""
      })
    });

    const tasks = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );

    expect(tasks[0]?.title).toBe("炉火缺矿");
    expect(tasks[0]?.description).toContain("缺少基础铁矿石");
  });

  it("does not create a task when the NPC cannot escrow the reward", async () => {
    const repo = new FakeNpcTaskRepo();
    repo.actors.set("npc-blacksmith", actor({ copperBalance: 20 }));
    repo.characters.set("character-1", character());
    const service = new NpcTaskService(repo);

    const tasks = await service.listTasksForAccount(
      "account-1",
      new Date("2026-07-02T08:00:00.000Z")
    );

    expect(tasks).toEqual([]);
    expect(repo.actors.get("npc-blacksmith")?.copperBalance).toBe(20);
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
});
