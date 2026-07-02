import {
  NPC_DIALOGUE_MAX_PLAYER_CHARS,
  NPC_DIALOGUE_PROMPT_VERSION,
  type NpcDialoguePromptContext
} from "@ai-mud/ai-prompts";
import { FIRST_ITEMS, getNpcByKey } from "@ai-mud/content";
import {
  addInventoryItem,
  decideNpcResourceRequest
} from "@ai-mud/game-rules";
import {
  CHARACTER_CLASSES,
  type AiCallLogDto,
  type ItemId,
  type NpcDialogueMessageDto,
  type NpcDialogueResponseDto,
  type NpcDialogueTargetDto,
  type NpcProfession
} from "@ai-mud/shared";
import { createHash } from "node:crypto";
import type { AiDialogueReply } from "../ai/ai-orchestrator.js";
import type { CharacterRecord, InventoryRecord, MarketInventoryRecord } from "../game/game.repository.js";
import type { VerifiedFavorProfile } from "../npc-memory/npc-memory.service.js";
import type {
  NpcActionRecord,
  NpcActorRecord,
  NpcEventRecord,
  NpcInventoryRecord
} from "../npc/npc.service.js";
import type { NpcTaskRecord } from "../npc-task/npc-task.repository.js";
import type {
  CreateAiCallLogInput,
  CreateDialogueMessageInput,
  DialogueMessageRecord,
  RelationshipRecord,
  UpsertRelationshipInput
} from "./dialogue.repository.js";

const BLACKPINE_OUTPOST_ID = "blackpine_outpost";
const RECENT_DIALOGUE_LIMIT = 6;
const RECENT_EVENT_LIMIT = 3;
const DIALOGUE_NPC_KEYS = new Set(["blackpine_blacksmith_borin", "blackpine_officer_elian"]);

type DialogueErrorCode = "VALIDATION_ERROR";

export class DialogueServiceError extends Error {
  constructor(
    public readonly code: DialogueErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DialogueServiceError";
  }
}

export interface DialogueRepositoryPort {
  listDialogueMessages(input: {
    characterId: string;
    npcActorId: string;
    limit: number;
  }): Promise<DialogueMessageRecord[]>;
  createDialogueMessage(input: CreateDialogueMessageInput): Promise<DialogueMessageRecord>;
  findRelationship(input: {
    characterId: string;
    npcActorId: string;
  }): Promise<RelationshipRecord | null>;
  upsertRelationship(input: UpsertRelationshipInput): Promise<void>;
  createAiCallLog(input: CreateAiCallLogInput): Promise<void>;
  listAiCallLogs(input: { limit: number }): Promise<AiCallLogDto[]>;
}

export interface DialogueGameRepositoryPort {
  findCharacterByAccountId(accountId: string): Promise<CharacterRecord | null>;
  listMarketInventory(settlementId: string): Promise<MarketInventoryRecord[]>;
  listInventory(characterId: string): Promise<InventoryRecord[]>;
  setInventoryItem(input: { characterId: string; itemId: ItemId; quantity: number }): Promise<void>;
  updateCharacterCopper(input: { characterId: string; copperBalance: number }): Promise<void>;
}

export interface DialogueNpcRepositoryPort {
  listNpcActors(): Promise<NpcActorRecord[]>;
  listNpcInventory(actorId: string): Promise<NpcInventoryRecord[]>;
  setNpcInventoryItem(input: { actorId: string; itemId: ItemId | string; quantity: number }): Promise<void>;
  updateNpcActor(input: { actorId: string; copperBalance: number }): Promise<void>;
  findActiveNpcAction(actorId: string): Promise<NpcActionRecord | null>;
  listNpcEvents(actorId: string, limit: number): Promise<NpcEventRecord[]>;
}

export interface DialogueTaskRepositoryPort {
  listTasksForCharacter(characterId: string): Promise<NpcTaskRecord[]>;
}

export interface DialogueAiPort {
  replyToNpcDialogue(input: {
    npcContext: NpcDialoguePromptContext;
    accountId: string;
    characterId: string;
    npcActorId: string;
  }): Promise<AiDialogueReply>;
}

export interface DialogueMemoryPort {
  recordDialogueExchange(input: {
    npcActorId: string;
    characterId: string;
    playerName: string;
    playerMessage: string;
    npcReply: string;
    occurredAt: Date;
    sourceIds?: string[];
  }): Promise<void>;
  getDialogueMemoryContext(input: {
    npcActorId: string;
    characterId: string;
    now?: Date;
  }): Promise<string>;
  recordSystemMemory(input: {
    npcActorId: string;
    characterId: string | null;
    memoryKind: "conversation" | "task";
    summary: string;
    importance: number;
    occurredAt: Date;
    sourceIds?: string[];
  }): Promise<void>;
  getVerifiedFavorProfile(input: {
    npcActorId: string;
    characterId: string;
    now?: Date;
  }): Promise<VerifiedFavorProfile>;
}

export interface DialogueServiceOptions {
  dialogueRepo: DialogueRepositoryPort;
  gameRepo: DialogueGameRepositoryPort;
  npcRepo: DialogueNpcRepositoryPort;
  taskRepo: DialogueTaskRepositoryPort;
  ai: DialogueAiPort;
  memory: DialogueMemoryPort;
  now?: () => Date;
}

interface ResolvedDialogueTarget {
  character: CharacterRecord;
  npc: NpcActorRecord;
  target: NpcDialogueTargetDto;
}

export class DialogueService {
  private readonly now: () => Date;

  constructor(private readonly options: DialogueServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async listDialogueTargets(accountId: string): Promise<NpcDialogueTargetDto[]> {
    const character = await this.options.gameRepo.findCharacterByAccountId(accountId);
    if (!character || character.currentLocation !== BLACKPINE_OUTPOST_ID) return [];

    const actors = await this.options.npcRepo.listNpcActors();
    const eligible = actors.filter((actor) => this.canTalkTo(actor));
    const tasks = await this.options.taskRepo.listTasksForCharacter(character.id);
    const targets = await Promise.all(eligible.map((actor) => this.toTarget(actor, tasks)));

    return targets;
  }

  async getDialogue(accountId: string, npcActorId: string): Promise<NpcDialogueResponseDto> {
    const resolved = await this.resolveTarget(accountId, npcActorId);
    const messages = await this.options.dialogueRepo.listDialogueMessages({
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id,
      limit: RECENT_DIALOGUE_LIMIT
    });

    return {
      target: resolved.target,
      messages: messages.map(toMessageDto),
      ai: {
        status: "fallback",
        provider: "none",
        model: "none",
        fallbackReason: null
      }
    };
  }

  async sendDialogueMessage(
    accountId: string,
    npcActorId: string,
    rawMessage: string
  ): Promise<NpcDialogueResponseDto> {
    const playerMessage = rawMessage.trim();
    if (!playerMessage) {
      throw new DialogueServiceError("VALIDATION_ERROR", "对话内容不能为空。");
    }
    if ([...playerMessage].length > NPC_DIALOGUE_MAX_PLAYER_CHARS) {
      throw new DialogueServiceError("VALIDATION_ERROR", "对话内容太长。");
    }

    const resolved = await this.resolveTarget(accountId, npcActorId);
    const now = this.now();

    const playerRecord = await this.options.dialogueRepo.createDialogueMessage({
      accountId,
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id,
      speakerType: "player",
      message: playerMessage,
      safetyFlags: [],
      createdAt: now
    });

    const resourceReply = await this.tryHandleResourceRequest({
      accountId,
      resolved,
      playerMessage,
      playerRecordId: playerRecord.id,
      now
    });
    if (resourceReply) return resourceReply;

    const promptContext = await this.buildPromptContext(resolved, playerMessage);
    const aiReply = await this.options.ai.replyToNpcDialogue({
      npcContext: promptContext,
      accountId,
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id
    });

    const npcRecord = await this.options.dialogueRepo.createDialogueMessage({
      accountId,
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id,
      speakerType: "npc",
      message: aiReply.reply,
      safetyFlags: aiReply.fallbackReason ? [aiReply.fallbackReason] : [],
      createdAt: now
    });

    await this.options.memory.recordDialogueExchange({
      npcActorId: resolved.npc.id,
      characterId: resolved.character.id,
      playerName: resolved.character.name,
      playerMessage,
      npcReply: aiReply.reply,
      occurredAt: now,
      sourceIds: [playerRecord.id, npcRecord.id]
    });

    await this.options.dialogueRepo.upsertRelationship({
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id,
      familiarityDelta: 1,
      trustDelta: 0,
      shortSummary: `${resolved.character.name} 最近与 ${resolved.npc.name} 有过交谈。`,
      interactedAt: now
    });

    await this.options.dialogueRepo.createAiCallLog({
      purpose: "npc_dialogue",
      status: aiReply.status,
      provider: aiReply.provider,
      model: aiReply.model,
      promptVersion: NPC_DIALOGUE_PROMPT_VERSION,
      accountId,
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id,
      requestHash: hashDialogueRequest({
        accountId,
        characterId: resolved.character.id,
        npcActorId: resolved.npc.id,
        message: playerMessage,
        createdAt: now.toISOString()
      }),
      inputSummary: truncate(playerMessage, 120),
      outputSummary: truncate(aiReply.reply, 120),
      latencyMs: aiReply.latencyMs,
      inputTokens: aiReply.inputTokens,
      outputTokens: aiReply.outputTokens,
      errorCode: aiReply.fallbackReason,
      createdAt: now
    });

    const messages = await this.options.dialogueRepo.listDialogueMessages({
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id,
      limit: RECENT_DIALOGUE_LIMIT
    });

    return {
      target: resolved.target,
      messages: messages.map(toMessageDto),
      ai: {
        status: aiReply.status,
        provider: aiReply.provider,
        model: aiReply.model,
        fallbackReason: aiReply.fallbackReason
      }
    };
  }

  async listAiCallLogs(limit = 50) {
    return this.options.dialogueRepo.listAiCallLogs({ limit });
  }

  private async resolveTarget(accountId: string, npcActorId: string): Promise<ResolvedDialogueTarget> {
    const character = await this.options.gameRepo.findCharacterByAccountId(accountId);
    if (!character) {
      throw new DialogueServiceError("VALIDATION_ERROR", "还没有可对话的角色。");
    }
    if (character.currentLocation !== BLACKPINE_OUTPOST_ID) {
      throw new DialogueServiceError("VALIDATION_ERROR", "只有在黑松哨站内才能与这些 NPC 对话。");
    }

    const actors = await this.options.npcRepo.listNpcActors();
    const npc = actors.find((actor) => actor.id === npcActorId);
    if (!npc || !this.canTalkTo(npc)) {
      throw new DialogueServiceError("VALIDATION_ERROR", "这个 NPC 暂时不能对话。");
    }

    return {
      character,
      npc,
      target: await this.toTarget(
        npc,
        await this.options.taskRepo.listTasksForCharacter(character.id)
      )
    };
  }

  private canTalkTo(actor: NpcActorRecord) {
    return (
      actor.actorType === "npc" &&
      actor.status === "active" &&
      actor.currentLocation === BLACKPINE_OUTPOST_ID &&
      DIALOGUE_NPC_KEYS.has(actor.npcKey)
    );
  }

  private async toTarget(
    actor: NpcActorRecord,
    tasks: NpcTaskRecord[]
  ): Promise<NpcDialogueTargetDto> {
    const visibleTask = findVisibleTaskForNpc(actor.id, tasks);
    return {
      npcActorId: actor.id,
      npcKey: actor.npcKey,
      name: actor.name,
      profession: actor.profession as NpcProfession,
      currentLocation: actor.currentLocation,
      statusLine: await this.buildStatusLine(actor),
      hasTask: Boolean(visibleTask),
      taskStatus: visibleTask?.status ?? null,
      taskTitle: visibleTask?.title ?? null
    };
  }

  private async buildStatusLine(actor: NpcActorRecord) {
    const action = await this.options.npcRepo.findActiveNpcAction(actor.id);
    if (action) return describeAction(actor, action);

    const inventory = await this.options.npcRepo.listNpcInventory(actor.id);
    if (actor.npcKey === "blackpine_blacksmith_borin") {
      const oreQuantity = inventory.find((item) => item.itemId === "iron_ore")?.quantity ?? 0;
      return oreQuantity > 0
        ? `正在清点 ${oreQuantity} 份基础铁矿石。`
        : "正在盘点基础铁矿石库存。";
    }
    if (actor.npcKey === "blackpine_officer_elian") {
      return "正在核对黑松哨站的市政账目。";
    }

    return "正在处理今日事务。";
  }

  private async buildPromptContext(
    resolved: ResolvedDialogueTarget,
    playerMessage: string
  ): Promise<NpcDialoguePromptContext> {
    const [
      messages,
      inventory,
      action,
      events,
      marketInventory,
      relationship,
      memorySummary
    ] = await Promise.all([
      this.options.dialogueRepo.listDialogueMessages({
        characterId: resolved.character.id,
        npcActorId: resolved.npc.id,
        limit: RECENT_DIALOGUE_LIMIT
      }),
      this.options.npcRepo.listNpcInventory(resolved.npc.id),
      this.options.npcRepo.findActiveNpcAction(resolved.npc.id),
      this.options.npcRepo.listNpcEvents(resolved.npc.id, RECENT_EVENT_LIMIT),
      this.options.gameRepo.listMarketInventory(BLACKPINE_OUTPOST_ID),
      this.options.dialogueRepo.findRelationship({
        characterId: resolved.character.id,
        npcActorId: resolved.npc.id
      }),
      this.options.memory.getDialogueMemoryContext({
        characterId: resolved.character.id,
        npcActorId: resolved.npc.id,
        now: this.now()
      })
    ]);
    const tasks = await this.options.taskRepo.listTasksForCharacter(resolved.character.id);
    const taskSummary = describeTaskSummary(resolved.npc.id, tasks);

    return {
      npc: {
        key: resolved.npc.npcKey,
        name: resolved.npc.name,
        profession: describeProfession(resolved.npc.profession),
        personality: describePersonality(resolved.npc.npcKey),
        memorySummary,
        taskSummary,
        currentState: [
          resolved.target.statusLine,
          taskSummary,
          describeInventory(inventory),
          action ? describeAction(resolved.npc, action) : null,
          relationship ? `关系记忆：${relationship.shortSummary}` : null,
          events.length > 0
            ? `近期事件：${events.map((event) => event.message).join("；")}`
            : null
        ]
          .filter((entry): entry is string => Boolean(entry))
          .join(" "),
      },
      player: {
        name: resolved.character.name,
        className:
          CHARACTER_CLASSES.find((entry) => entry.id === resolved.character.classId)?.name ??
          resolved.character.classId,
        level: resolved.character.level,
        stateSummary: `生命 ${resolved.character.hp}/${resolved.character.maxHp}，饱腹度 ${resolved.character.hunger}/5，持有 ${resolved.character.copperBalance} 铜币。`
      },
      world: {
        settlement: "黑松哨站",
        marketSummary: describeMarket(marketInventory)
      },
      recentMessages: messages.flatMap((message) => {
        if (message.speakerType !== "player" && message.speakerType !== "npc") return [];
        return [{ speaker: message.speakerType, message: message.message }];
      }),
      playerMessage
    };
  }

  private async tryHandleResourceRequest(input: {
    accountId: string;
    resolved: ResolvedDialogueTarget;
    playerMessage: string;
    playerRecordId: string;
    now: Date;
  }): Promise<NpcDialogueResponseDto | null> {
    const [inventory, relationship, favorProfile] = await Promise.all([
      this.options.npcRepo.listNpcInventory(input.resolved.npc.id),
      this.options.dialogueRepo.findRelationship({
        characterId: input.resolved.character.id,
        npcActorId: input.resolved.npc.id
      }),
      this.options.memory.getVerifiedFavorProfile({
        characterId: input.resolved.character.id,
        npcActorId: input.resolved.npc.id,
        now: input.now
      })
    ]);
    const decision = decideNpcResourceRequest({
      message: input.playerMessage,
      npcInventory: inventory,
      npcCopper: input.resolved.npc.copperBalance,
      relationship: relationship
        ? { familiarity: relationship.familiarity, trust: relationship.trust }
        : null,
      verifiedFavorScore: favorProfile.score,
      recentGrantCount: favorProfile.recentGrantCount
    });

    if (decision.outcome === "no_request") return null;

    const reply = await this.applyResourceRequestDecision({
      character: input.resolved.character,
      npc: input.resolved.npc,
      inventory,
      decision
    });
    const npcRecord = await this.options.dialogueRepo.createDialogueMessage({
      accountId: input.accountId,
      characterId: input.resolved.character.id,
      npcActorId: input.resolved.npc.id,
      speakerType: "npc",
      message: reply,
      safetyFlags: [`resource_request:${decision.reason}`],
      createdAt: input.now
    });

    await this.options.memory.recordDialogueExchange({
      npcActorId: input.resolved.npc.id,
      characterId: input.resolved.character.id,
      playerName: input.resolved.character.name,
      playerMessage: input.playerMessage,
      npcReply: reply,
      occurredAt: input.now,
      sourceIds: [input.playerRecordId, npcRecord.id]
    });
    await this.options.memory.recordSystemMemory({
      npcActorId: input.resolved.npc.id,
      characterId: input.resolved.character.id,
      memoryKind: "conversation",
      importance: decision.outcome === "granted" ? 4 : 2,
      occurredAt: input.now,
      sourceIds: [input.playerRecordId, npcRecord.id],
      summary: buildResourceRequestMemorySummary(input.resolved.character.name, decision)
    });
    await this.options.dialogueRepo.upsertRelationship({
      characterId: input.resolved.character.id,
      npcActorId: input.resolved.npc.id,
      familiarityDelta: 1,
      trustDelta: 0,
      shortSummary: `${input.resolved.character.name} 向 ${input.resolved.npc.name} 提出过物资请求。`,
      interactedAt: input.now
    });

    const messages = await this.options.dialogueRepo.listDialogueMessages({
      characterId: input.resolved.character.id,
      npcActorId: input.resolved.npc.id,
      limit: RECENT_DIALOGUE_LIMIT
    });

    return {
      target: input.resolved.target,
      messages: messages.map(toMessageDto),
      ai: {
        status: "fallback",
        provider: "rules",
        model: "npc-resource-request",
        fallbackReason: decision.reason
      }
    };
  }

  private async applyResourceRequestDecision(input: {
    character: CharacterRecord;
    npc: NpcActorRecord;
    inventory: NpcInventoryRecord[];
    decision: Exclude<ReturnType<typeof decideNpcResourceRequest>, { outcome: "no_request" }>;
  }) {
    if (input.decision.outcome === "rejected") {
      return buildResourceRequestRejection(input.npc.name, input.decision);
    }

    const request = input.decision.request;
    if (request.kind === "copper") {
      await this.options.npcRepo.updateNpcActor({
        actorId: input.npc.id,
        copperBalance: input.npc.copperBalance - request.copper
      });
      await this.options.gameRepo.updateCharacterCopper({
        characterId: input.character.id,
        copperBalance: input.character.copperBalance + request.copper
      });
      return `${input.npc.name} 数出 ${request.copper} 枚铜币递给你：“拿去，别乱花。”`;
    }

    const stack = input.inventory.find((entry) => entry.itemId === request.itemId);
    const nextNpcQuantity = (stack?.quantity ?? 0) - request.quantity;
    await this.options.npcRepo.setNpcInventoryItem({
      actorId: input.npc.id,
      itemId: request.itemId,
      quantity: nextNpcQuantity
    });
    const playerInventory = await this.options.gameRepo.listInventory(input.character.id);
    const nextPlayerInventory = addInventoryItem(playerInventory, request.itemId, request.quantity);
    const playerStack = nextPlayerInventory.find((entry) => entry.itemId === request.itemId);
    if (!playerStack) throw new Error("Failed to calculate player inventory grant");
    await this.options.gameRepo.setInventoryItem({
      characterId: input.character.id,
      itemId: request.itemId,
      quantity: playerStack.quantity
    });

    return `${input.npc.name} 从自己的库存里取出 ${describeItem(request.itemId)} x${request.quantity} 交给你：“这是我能拿出来的。”`;
  }
}

function describeProfession(profession: string) {
  const names: Record<string, string> = {
    farmer: "农民",
    miner: "矿工",
    blacksmith: "铁匠",
    municipal_officer: "市政官"
  };
  return names[profession] ?? profession;
}

function describePersonality(npcKey: string) {
  const definition = getNpcByKey(npcKey);
  if (definition?.profession === "blacksmith") {
    return "务实、重视等价交换，缺材料时会直接表达需求，但不会凭空许诺奖励。";
  }
  if (definition?.profession === "municipal_officer") {
    return "谨慎、守规矩，关注市政库存、税收和村民生计。";
  }
  return "谨慎，重视现实库存和当前处境。";
}

function describeInventory(inventory: NpcInventoryRecord[]) {
  if (inventory.length === 0) return "随身库存为空。";
  return `随身库存：${inventory
    .map((entry) => `${describeItem(entry.itemId)} x${entry.quantity}`)
    .join("，")}。`;
}

function describeMarket(inventory: MarketInventoryRecord[]) {
  if (inventory.length === 0) return "集市暂无库存记录。";
  return inventory
    .map(
      (entry) =>
        `${describeItem(entry.itemId)} ${entry.quantity}/${entry.targetQuantity}，收购 ${entry.baseBuyPriceCopper} 铜，出售 ${entry.baseSellPriceCopper} 铜`
    )
    .join("；");
}

function describeItem(itemId: string) {
  return FIRST_ITEMS.find((item) => item.id === itemId)?.name ?? itemId;
}

function describeAction(actor: NpcActorRecord, action: NpcActionRecord) {
  if (action.actionType === "gathering") return `${actor.name} 正在野外采集。`;
  if (action.actionType === "travel") return `${actor.name} 正在路上移动。`;
  if (action.actionType === "market_buy") return `${actor.name} 正在集市采购。`;
  if (action.actionType === "market_sell") return `${actor.name} 正在集市出售物资。`;
  if (action.actionType === "eat") return `${actor.name} 正在吃饭。`;
  return `${actor.name} 正在处理 ${action.actionType}。`;
}

type VisibleDialogueTask = NpcTaskRecord & { status: "open" | "accepted" };

function findVisibleTaskForNpc(
  npcActorId: string,
  tasks: NpcTaskRecord[]
): VisibleDialogueTask | null {
  const visible = tasks.find(
    (task): task is VisibleDialogueTask =>
      task.npcActorId === npcActorId && (task.status === "open" || task.status === "accepted")
  );
  return visible ?? null;
}

function describeTaskSummary(npcActorId: string, tasks: NpcTaskRecord[]) {
  const task = findVisibleTaskForNpc(npcActorId, tasks);
  if (!task) return "当前没有可对该玩家展示的真实任务。";

  const statusText = task.status === "open" ? "可接取" : "已接取";
  return `真实任务：${task.title}，状态${statusText}，需要 ${describeItem(task.requestedItemId)} x${task.requestedQuantity}，托管奖励 ${task.rewardCopper} 铜。`;
}

type HandledResourceDecision = Exclude<
  ReturnType<typeof decideNpcResourceRequest>,
  { outcome: "no_request" }
>;

function buildResourceRequestRejection(npcName: string, decision: HandledResourceDecision) {
  const itemName =
    decision.request.kind === "item" ? describeItem(decision.request.itemId) : "铜币";
  const reasonText: Record<HandledResourceDecision["reason"], string> = {
    rule_verified: "可以拿给你",
    unsupported_item: "我手里没有这种东西",
    low_relationship: "我们还没熟到能开这个口",
    insufficient_inventory: `我现在没有足够的${itemName}`,
    insufficient_copper: "我身上没有足够的铜币",
    reserve_required: "这些我还得留着维持自己的活计",
    quantity_too_high: "你要得太多了",
    recently_helped: "我刚帮过你，不能总这样掏自己的库存"
  };
  return `${npcName} 摇头：“${reasonText[decision.reason]}。”`;
}

function buildResourceRequestMemorySummary(
  playerName: string,
  decision: HandledResourceDecision
) {
  const requestText =
    decision.request.kind === "item"
      ? `${describeItem(decision.request.itemId)} x${decision.request.quantity}`
      : `${decision.request.copper} 铜`;
  if (decision.outcome === "granted") {
    return `${playerName} 提出物资请求，NPC 基于真实库存让渡了 ${requestText}。`;
  }
  return `${playerName} 提出物资请求 ${requestText}，NPC 基于规则拒绝，原因：${decision.reason}。`;
}

function toMessageDto(record: DialogueMessageRecord): NpcDialogueMessageDto {
  return {
    id: record.id,
    npcActorId: record.npcActorId,
    speakerType: record.speakerType,
    message: record.message,
    createdAt: record.createdAt.toISOString()
  };
}

function truncate(value: string, max: number) {
  return [...value].slice(0, max).join("");
}

function hashDialogueRequest(input: Record<string, string>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
