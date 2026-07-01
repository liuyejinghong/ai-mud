import type {
  CreateCharacterRequestDto,
  GameStateDto,
  MarketDto,
  MarketTradeRequestDto,
  MoveRequestDto,
  RepairEquipmentRequestDto,
  RepairQuoteDto,
  StartGatheringRequestDto
} from "@ai-mud/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:3000";

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
    throw new Error(`Game request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getGameState() {
  return requestGame<GameStateDto>("/game/state");
}

export function createCharacter(input: CreateCharacterRequestDto, csrfToken: string) {
  return requestGame<GameStateDto>("/game/characters", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify(input)
  });
}

export function enterCorruptForest(csrfToken: string) {
  return requestGame<GameStateDto>("/game/enter-zone", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({ zoneId: "corrupt_forest" })
  });
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
