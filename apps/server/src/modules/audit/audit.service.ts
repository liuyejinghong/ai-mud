export interface AuditWriter {
  write(input: {
    actorAccountId: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
