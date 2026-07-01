export interface SoftResetRequest {
  actorAccountId: string;
  confirmationText: string;
  reason: string;
}

export class WorldResetService {
  async requestSoftReset(input: SoftResetRequest) {
    if (input.confirmationText !== "RESET WORLD") {
      return { ok: false as const, reason: "CONFIRMATION_REQUIRED" as const };
    }

    if (input.reason.trim().length < 8) {
      return { ok: false as const, reason: "REASON_REQUIRED" as const };
    }

    return {
      ok: true as const,
      mode: "dry_run" as const,
      message: "Soft Reset is acknowledged but not destructive in v0.1"
    };
  }
}
