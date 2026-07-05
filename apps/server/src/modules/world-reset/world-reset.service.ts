import type { WorldResetResponseDto } from "@ai-mud/shared";
import type { AuditWriter } from "../audit/audit.service.js";

export const WORLD_RESET_CONFIRMATION_TEXT = "RESET BLACKPINE";

export interface WorldResetRequest {
  actorAccountId: string;
  confirmationText: string;
  reason: string;
}

export interface WorldResetRepositoryPort {
  resetWorldState(input: { resetAt: Date }): Promise<{ clearedTables: string[] }>;
  seedBaseWorld(input: { resetAt: Date }): Promise<void>;
}

export class WorldResetServiceError extends Error {
  constructor(readonly code: "VALIDATION_ERROR", message: string) {
    super(message);
  }
}

export class WorldResetService {
  constructor(
    private readonly options: {
      repository: WorldResetRepositoryPort;
      audit: AuditWriter;
      now?: () => Date;
    }
  ) {}

  async resetWorld(input: WorldResetRequest): Promise<WorldResetResponseDto> {
    const reason = input.reason.trim();
    if (input.confirmationText !== WORLD_RESET_CONFIRMATION_TEXT) {
      throw new WorldResetServiceError("VALIDATION_ERROR", "确认短语不正确。");
    }

    if (reason.length < 8) {
      throw new WorldResetServiceError("VALIDATION_ERROR", "请填写至少 8 个字的重置原因。");
    }

    const resetAt = this.options.now?.() ?? new Date();

    await this.options.audit.write({
      actorAccountId: input.actorAccountId,
      action: "world_reset.request",
      targetType: "world",
      targetId: null,
      reason,
      metadata: { confirmationText: input.confirmationText }
    });

    const reset = await this.options.repository.resetWorldState({ resetAt });
    await this.options.repository.seedBaseWorld({ resetAt });

    await this.options.audit.write({
      actorAccountId: input.actorAccountId,
      action: "world_reset.complete",
      targetType: "world",
      targetId: null,
      reason,
      metadata: {
        clearedTables: reset.clearedTables,
        resetAt: resetAt.toISOString()
      }
    });

    return {
      ok: true,
      mode: "world_reset",
      resetAt: resetAt.toISOString(),
      clearedTables: reset.clearedTables,
      message: "世界已重置并完成基础初始化。"
    };
  }
}
