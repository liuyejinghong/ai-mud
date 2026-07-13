import type { CurrentUserDto, LoginRequestDto, RegisterRequestDto } from "@ai-mud/shared";

export interface AuthSessionDto {
  user: CurrentUserDto;
  csrfToken: string;
}

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

export async function logout() {
  const response = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Unable to end session");
  }
}

export async function getCurrentSession(): Promise<AuthSessionDto> {
  const response = await fetch(`${API_BASE}/auth/me`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Not signed in");
  }

  return response.json() as Promise<AuthSessionDto>;
}
