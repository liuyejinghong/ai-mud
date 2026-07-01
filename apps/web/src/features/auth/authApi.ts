import type { LoginRequestDto, RegisterRequestDto } from "@ai-mud/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:3000";

async function postAuth(path: string, body: LoginRequestDto | RegisterRequestDto) {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
}

export async function registerAccount(input: RegisterRequestDto) {
  return postAuth("/auth/register", input);
}

export async function login(input: LoginRequestDto) {
  return postAuth("/auth/login", input);
}
