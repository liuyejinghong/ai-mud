import type { CreateActivationCodeResponseDto } from "@ai-mud/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:3000";

export async function createActivationCode(note: string): Promise<CreateActivationCodeResponseDto> {
  const response = await fetch(`${API_BASE}/admin/activation-codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ note: note.trim() || undefined })
  });

  if (!response.ok) {
    throw new Error("Failed to create activation code");
  }

  return response.json() as Promise<CreateActivationCodeResponseDto>;
}
