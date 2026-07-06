import type { AccountRole, AccountStatus } from "./auth.js";
import type { MoneyDto } from "./game.js";

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

export interface WorldResetRequestDto {
  confirmationText: string;
  reason: string;
}

export interface WorldResetResponseDto {
  ok: true;
  mode: "world_reset";
  resetAt: string;
  clearedTables: string[];
  message: string;
}

export type AssetLedgerBucket =
  | "player"
  | "npc"
  | "municipal"
  | "escrow"
  | "system_source"
  | "system_sink";

export type AssetLedgerHealthStatus = "ok" | "drift_detected";

export interface AssetLedgerBucketSnapshotDto {
  bucket: AssetLedgerBucket;
  expectedCopper: MoneyDto;
  actualCopper: MoneyDto | null;
  driftCopper: MoneyDto | null;
}

export interface AssetLedgerHealthDto {
  generatedAt: string;
  status: AssetLedgerHealthStatus;
  totalDrift: MoneyDto;
  buckets: AssetLedgerBucketSnapshotDto[];
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
