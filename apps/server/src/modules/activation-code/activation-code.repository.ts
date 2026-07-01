import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { activationCodes } from "../../db/schema.js";
import type { ActivationCodeRecord, ActivationCodeRepository } from "./activation-code.service.js";

type ActivationCodeDb = Pick<Db, "insert" | "select" | "update">;

export class DrizzleActivationCodeRepository implements ActivationCodeRepository {
  constructor(private readonly db: ActivationCodeDb) {}

  async insert(record: ActivationCodeRecord & { note?: string | null; createdByAdminId?: string | null }) {
    await this.db.insert(activationCodes).values({
      id: record.id,
      codeHash: record.codeHash,
      status: record.status,
      note: record.note ?? null,
      createdByAdminId: record.createdByAdminId ?? null,
      usedByAccountId: record.usedByAccountId,
      expiresAt: record.expiresAt
    });
  }

  async findByHash(codeHash: string): Promise<ActivationCodeRecord | null> {
    const [record] = await this.db
      .select({
        id: activationCodes.id,
        codeHash: activationCodes.codeHash,
        status: activationCodes.status,
        usedByAccountId: activationCodes.usedByAccountId,
        expiresAt: activationCodes.expiresAt
      })
      .from(activationCodes)
      .where(eq(activationCodes.codeHash, codeHash))
      .limit(1);

    return record ?? null;
  }

  async markUsed(id: string, accountId: string): Promise<boolean> {
    const [updated] = await this.db
      .update(activationCodes)
      .set({
        status: "used",
        usedByAccountId: accountId,
        usedAt: new Date()
      })
      .where(
        and(
          eq(activationCodes.id, id),
          eq(activationCodes.status, "unused"),
          isNull(activationCodes.usedByAccountId),
          or(isNull(activationCodes.expiresAt), gt(activationCodes.expiresAt, new Date()))
        )
      )
      .returning({ id: activationCodes.id });

    return Boolean(updated);
  }

  async listForAdmin() {
    return this.db
      .select({
        id: activationCodes.id,
        status: activationCodes.status,
        note: activationCodes.note,
        usedByAccountId: activationCodes.usedByAccountId,
        expiresAt: activationCodes.expiresAt,
        createdAt: activationCodes.createdAt,
        usedAt: activationCodes.usedAt,
        revokedAt: activationCodes.revokedAt
      })
      .from(activationCodes)
      .orderBy(activationCodes.createdAt);
  }
}
