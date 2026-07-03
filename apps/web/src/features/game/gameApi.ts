import type {
  ChatMessageDto,
  CreateCharacterRequestDto,
  EatFoodRequestDto,
  EquipEquipmentRequestDto,
  GameLocationId,
  GameStateDto,
  GameSyncResponseDto,
  MarketDto,
  MarketTradeRequestDto,
  MoveRequestDto,
  NpcDialogueResponseDto,
  NpcDialogueTargetDto,
  RepairEquipmentRequestDto,
  RepairQuoteDto,
  StartGatheringRequestDto
} from "@ai-mud/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:3000";

export class GameApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function isErrorResponse(value: unknown): value is { error: { code: string; message: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "object" &&
    (value as { error: { code?: unknown } }).error !== null &&
    typeof (value as { error: { code?: unknown } }).error.code === "string" &&
    typeof (value as { error: { message?: unknown } }).error.message === "string"
  );
}

async function requestGame<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    let code = response.status === 401 ? "UNAUTHENTICATED" : "REQUEST_FAILED";
    let message =
      response.status === 401 ? "登录已失效，请重新登录。" : `请求失败：${response.status}`;
    try {
      const body = (await response.json()) as unknown;
      if (isErrorResponse(body)) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // Keep the status-derived fallback when the server did not return JSON.
    }
    throw new GameApiError(response.status, code, message);
  }

  return response.json() as Promise<T>;
}

export function getGameState() {
  return requestGame<GameStateDto>("/game/state");
}

export function getGameSync(cursor?: number) {
  const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(String(cursor))}`;
  return requestGame<GameSyncResponseDto>(`/game/sync${query}`);
}

export function sendLobbyChat(body: string, csrfToken: string) {
  return requestGame<ChatMessageDto>("/game/chat", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({ body })
  });
}

export function heartbeatPresence(csrfToken: string) {
  return requestGame<{ ok: true }>("/game/presence/heartbeat", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({})
  });
}

export function createCharacter(input: CreateCharacterRequestDto, csrfToken: string) {
  return requestGame<GameStateDto>("/game/characters", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify(input)
  });
}

export function enterZone(zoneId: GameLocationId, csrfToken: string) {
  return requestGame<GameStateDto>("/game/enter-zone", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({ zoneId })
  });
}

export function enterCorruptForest(csrfToken: string) {
  return enterZone("corrupt_forest", csrfToken);
}

export function enterOldMine(csrfToken: string) {
  return enterZone("old_mine", csrfToken);
}

export function move(direction: MoveRequestDto["direction"], csrfToken: string) {
  return requestGame<GameStateDto>("/game/move", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({ direction })
  });
}

export function startGathering(input: StartGatheringRequestDto, csrfToken: string) {
  return requestGame<GameStateDto>("/game/gather", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify(input)
  });
}

export function startCombat(csrfToken: string) {
  return requestGame<GameStateDto>("/game/combat/start", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({})
  });
}

export function cancelAction(csrfToken: string) {
  return requestGame<GameStateDto>("/game/action/cancel", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({})
  });
}

export function eatFood(input: EatFoodRequestDto, csrfToken: string) {
  return requestGame<GameStateDto>("/game/eat", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify(input)
  });
}

export function returnToVillage(csrfToken: string) {
  return requestGame<GameStateDto>("/game/return-village", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({})
  });
}

export function getMarket() {
  return requestGame<MarketDto>("/game/market");
}

export function listDialogueTargets() {
  return requestGame<NpcDialogueTargetDto[]>("/game/npcs/dialogue-targets");
}

export function getNpcDialogue(npcActorId: string) {
  return requestGame<NpcDialogueResponseDto>(`/game/npcs/${npcActorId}/dialogue`);
}

export function sendNpcDialogueMessage(npcActorId: string, message: string, csrfToken: string) {
  return requestGame<NpcDialogueResponseDto>(`/game/npcs/${npcActorId}/dialogue`, {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({ message })
  });
}

export function acceptNpcTask(taskId: string, csrfToken: string) {
  return requestGame<GameStateDto>(`/game/npc-tasks/${taskId}/accept`, {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({})
  });
}

export function completeNpcTask(taskId: string, csrfToken: string) {
  return requestGame<GameStateDto>(`/game/npc-tasks/${taskId}/complete`, {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({})
  });
}

export function buyMarketItem(input: MarketTradeRequestDto, csrfToken: string) {
  return requestGame<GameStateDto>("/game/market/buy", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify(input)
  });
}

export function sellMarketItem(input: MarketTradeRequestDto, csrfToken: string) {
  return requestGame<GameStateDto>("/game/market/sell", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify(input)
  });
}

export function getRepairQuote(input: RepairEquipmentRequestDto, csrfToken: string) {
  return requestGame<RepairQuoteDto>("/game/repair/quote", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify(input)
  });
}

export function repairEquipment(input: RepairEquipmentRequestDto, csrfToken: string) {
  return requestGame<GameStateDto>("/game/repair", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify(input)
  });
}

export function repairAllEquipment(csrfToken: string) {
  return requestGame<GameStateDto>("/game/repair/all", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({})
  });
}

export function equipEquipment(input: EquipEquipmentRequestDto, csrfToken: string) {
  return requestGame<GameStateDto>("/game/equipment/equip", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify(input)
  });
}
