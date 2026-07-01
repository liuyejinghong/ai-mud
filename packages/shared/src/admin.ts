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
