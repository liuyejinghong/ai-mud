import type { Db } from "../../db/client.js";
import { auditLogs } from "../../db/schema.js";
import type { AuditWriter } from "./audit.service.js";

type AuditDb = Pick<Db, "insert">;

export class DrizzleAuditWriter implements AuditWriter {
  constructor(private readonly db: AuditDb) {}

  async write(input: Parameters<AuditWriter["write"]>[0]): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorAccountId: input.actorAccountId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {}
    });
  }
}
