import type { CreateActivationCodeResponseDto, EconomySnapshotDto } from "@ai-mud/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:3000";

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
