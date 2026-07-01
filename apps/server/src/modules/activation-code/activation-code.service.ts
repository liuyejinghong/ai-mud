import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ErrorCode } from "@ai-mud/shared";

export interface ActivationCodeRecord {
  id: string;
  codeHash: string;
  status: "unused" | "used" | "expired" | "revoked";
  usedByAccountId: string | null;
  expiresAt: Date | null;
}

export interface ActivationCodeRepository {
  insert(record: ActivationCodeRecord & { note?: string | null; createdByAdminId?: string | null }): Promise<void>;
  findByHash(codeHash: string): Promise<ActivationCodeRecord | null>;
  markUsed(id: string, accountId: string): Promise<boolean>;
}

export function normalizeActivationCode(code: string) {
  return code.trim().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, "");
}

export class ActivationCodeService {
  constructor(private readonly repo: ActivationCodeRepository) {}

  async create(input: { note?: string; createdByAdminId?: string | null; expiresAt?: Date | null }) {
    const code = randomBytes(18).toString("base64url").slice(0, 24);
    const record = {
      id: randomUUID(),
      codeHash: this.hash(code),
      status: "unused" as const,
      usedByAccountId: null,
      expiresAt: input.expiresAt ?? null,
      note: input.note ?? null,
      createdByAdminId: input.createdByAdminId ?? null
    };

    await this.repo.insert(record);
    return { code, activationCodeId: record.id };
  }

  async consume(
    code: string,
    accountId: string
  ): Promise<{ ok: true; activationCodeId: string } | { ok: false; reason: ErrorCode }> {
    const record = await this.repo.findByHash(this.hash(code));
    if (!record) return { ok: false, reason: "ACTIVATION_CODE_INVALID" };
    if (record.status === "used") return { ok: false, reason: "ACTIVATION_CODE_USED" };
    if (record.status === "revoked") return { ok: false, reason: "ACTIVATION_CODE_INVALID" };
    if (record.status === "expired" || (record.expiresAt && record.expiresAt.getTime() <= Date.now())) {
      return { ok: false, reason: "ACTIVATION_CODE_EXPIRED" };
    }

    const markedUsed = await this.repo.markUsed(record.id, accountId);
    if (!markedUsed) {
      if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
        return { ok: false, reason: "ACTIVATION_CODE_EXPIRED" };
      }
      return { ok: false, reason: "ACTIVATION_CODE_USED" };
    }

    return { ok: true, activationCodeId: record.id };
  }

  private hash(code: string) {
    return createHash("sha256").update(normalizeActivationCode(code)).digest("hex");
  }
}
