import type {
  AiCallLogDto,
  AiLayerStatusDto,
  CreateActivationCodeResponseDto,
  EconomySnapshotDto,
  MoneyDto,
  NpcMemoryEntryDto,
  NpcMemoryFragmentDto,
  NpcSimulationReportDto,
  NpcSummaryDto,
  WorldRuntimeStatusDto
} from "@ai-mud/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:3000";

export interface NpcSnapshotResponse {
  generatedAt: string;
  settlementId: "blackpine_outpost";
  treasury: MoneyDto;
  npcs: NpcSummaryDto[];
}

export interface AiCallLogResponse {
  generatedAt: string;
  aiCalls: AiCallLogDto[];
}

export interface NpcMemoryResponse {
  generatedAt: string;
  entries: NpcMemoryEntryDto[];
  fragments: NpcMemoryFragmentDto[];
}

export async function createActivationCode(
  note: string,
  csrfToken: string
): Promise<CreateActivationCodeResponseDto> {
  const response = await fetch(`${API_BASE}/admin/activation-codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ai-mud-csrf": csrfToken },
    credentials: "include",
    body: JSON.stringify({ note: note.trim() || undefined })
  });

  if (!response.ok) {
    throw new Error("Failed to create activation code");
  }

  return response.json() as Promise<CreateActivationCodeResponseDto>;
}

export async function getEconomySnapshot(): Promise<EconomySnapshotDto> {
  const response = await fetch(`${API_BASE}/admin/economy`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Failed to load economy snapshot");
  }

  return response.json() as Promise<EconomySnapshotDto>;
}

export async function getNpcSnapshot(): Promise<NpcSnapshotResponse> {
  const response = await fetch(`${API_BASE}/admin/npcs`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Failed to load NPC snapshot");
  }

  return response.json() as Promise<NpcSnapshotResponse>;
}

export async function getWorldRuntimeStatus(): Promise<WorldRuntimeStatusDto> {
  const response = await fetch(`${API_BASE}/admin/world-runtime`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Failed to load world runtime status");
  }

  return response.json() as Promise<WorldRuntimeStatusDto>;
}

export async function getAiCallLogs(): Promise<AiCallLogResponse> {
  const response = await fetch(`${API_BASE}/admin/ai-calls`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Failed to load AI call logs");
  }

  return response.json() as Promise<AiCallLogResponse>;
}

export async function getAiLayerStatus(): Promise<AiLayerStatusDto> {
  const response = await fetch(`${API_BASE}/admin/ai-layer/status`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Failed to load AI layer status");
  }

  return response.json() as Promise<AiLayerStatusDto>;
}

export async function getNpcMemory(): Promise<NpcMemoryResponse> {
  const response = await fetch(`${API_BASE}/admin/npc-memory`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Failed to load NPC memory");
  }

  return response.json() as Promise<NpcMemoryResponse>;
}

export async function settleNpcWorld(csrfToken: string): Promise<NpcSnapshotResponse> {
  const response = await fetch(`${API_BASE}/admin/npcs/settle`, {
    method: "POST",
    headers: { "x-ai-mud-csrf": csrfToken },
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Failed to settle NPC world");
  }

  return response.json() as Promise<NpcSnapshotResponse>;
}

export async function runNpcSimulation(
  csrfToken: string,
  days: number
): Promise<NpcSimulationReportDto> {
  const response = await fetch(`${API_BASE}/admin/npcs/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ai-mud-csrf": csrfToken },
    credentials: "include",
    body: JSON.stringify({ days })
  });

  if (!response.ok) {
    throw new Error("Failed to run NPC simulation");
  }

  return response.json() as Promise<NpcSimulationReportDto>;
}
