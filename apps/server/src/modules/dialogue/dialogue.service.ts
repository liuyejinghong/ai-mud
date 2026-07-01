import {
  NPC_DIALOGUE_MAX_PLAYER_CHARS,
  NPC_DIALOGUE_PROMPT_VERSION,
  type NpcDialoguePromptContext
} from "@ai-mud/ai-prompts";
import { FIRST_ITEMS, getNpcByKey } from "@ai-mud/content";
import {
  CHARACTER_CLASSES,
  type AiCallLogDto,
  type NpcDialogueMessageDto,
  type NpcDialogueResponseDto,
  type NpcDialogueTargetDto,
  type NpcProfession
} from "@ai-mud/shared";
import { createHash } from "node:crypto";
import type { AiDialogueReply } from "../ai/ai-orchestrator.js";
import type { CharacterRecord, MarketInventoryRecord } from "../game/game.repository.js";
import type {
  NpcActionRecord,
  NpcActorRecord,
  NpcEventRecord,
  NpcInventoryRecord
} from "../npc/npc.service.js";
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
}

export interface DialogueNpcRepositoryPort {
  listNpcActors(): Promise<NpcActorRecord[]>;
  listNpcInventory(actorId: string): Promise<NpcInventoryRecord[]>;
  findActiveNpcAction(actorId: string): Promise<NpcActionRecord | null>;
  listNpcEvents(actorId: string, limit: number): Promise<NpcEventRecord[]>;
}

export interface DialogueAiPort {
  replyToNpcDialogue(input: {
    npcContext: NpcDialoguePromptContext;
    accountId: string;
    characterId: string;
    npcActorId: string;
  }): Promise<AiDialogueReply>;
}

export interface DialogueServiceOptions {
  dialogueRepo: DialogueRepositoryPort;
  gameRepo: DialogueGameRepositoryPort;
  npcRepo: DialogueNpcRepositoryPort;
  ai: DialogueAiPort;
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
    const targets = await Promise.all(eligible.map((actor) => this.toTarget(actor)));

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

    await this.options.dialogueRepo.createDialogueMessage({
      accountId,
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id,
      speakerType: "player",
      message: playerMessage,
      safetyFlags: [],
      createdAt: now
    });

    const promptContext = await this.buildPromptContext(resolved, playerMessage);
    const aiReply = await this.options.ai.replyToNpcDialogue({
      npcContext: promptContext,
      accountId,
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id
    });

    await this.options.dialogueRepo.createDialogueMessage({
      accountId,
      characterId: resolved.character.id,
      npcActorId: resolved.npc.id,
      speakerType: "npc",
      message: aiReply.reply,
      safetyFlags: aiReply.fallbackReason ? [aiReply.fallbackReason] : [],
      createdAt: now
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
      target: await this.toTarget(npc)
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

  private async toTarget(actor: NpcActorRecord): Promise<NpcDialogueTargetDto> {
    return {
      npcActorId: actor.id,
      npcKey: actor.npcKey,
      name: actor.name,
      profession: actor.profession as NpcProfession,
      currentLocation: actor.currentLocation,
      statusLine: await this.buildStatusLine(actor)
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
    const [messages, inventory, action, events, marketInventory, relationship] = await Promise.all([
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
      })
    ]);

    return {
      npc: {
        key: resolved.npc.npcKey,
        name: resolved.npc.name,
        profession: describeProfession(resolved.npc.profession),
        personality: describePersonality(resolved.npc.npcKey),
        currentState: [
          resolved.target.statusLine,
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
