import type { AccountRole, AccountStatus } from "./auth.js";

export type ActivationCodeStatus = "unused" | "used" | "expired" | "revoked";

export interface ActivationCodeDto {
  id: string;
  status: ActivationCodeStatus;
  note: string | null;
  usedByAccountId: string | null;
  expiresAt: string | null;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export interface CreateActivationCodeRequestDto {
  note?: string;
  expiresAt?: string;
}

export interface CreateActivationCodeResponseDto {
  code: string;
  activationCode: ActivationCodeDto;
}

export interface PublishSystemAnnouncementRequestDto {
  body: string;
}

export interface AdminAccountDto {
  id: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AccountOperationResponseDto {
  account: AdminAccountDto;
  revokedSessionCount: number;
}

export interface RevokeSessionsResponseDto {
  accountId: string;
  revokedSessionCount: number;
}
