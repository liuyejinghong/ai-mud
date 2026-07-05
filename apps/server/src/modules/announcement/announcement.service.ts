import type { ChatMessageDto } from "@ai-mud/shared";
import type { AuditWriter } from "../audit/audit.service.js";

export const SYSTEM_ANNOUNCEMENT_MAX_CHARS = 240;

export interface SystemAnnouncementRecord {
  id: string;
  adminAccountId: string;
  body: string;
  severity: "info";
  createdAt: Date;
}

export interface AnnouncementRepositoryPort {
  createSystemAnnouncement(input: {
    adminAccountId: string;
    body: string;
    createdAt: Date;
  }): Promise<SystemAnnouncementRecord>;
  writePublicSyncEvent(input: {
    eventType: "system.announcement";
    payload: { announcementId: string; severity: "info" };
    source: "admin";
  }): Promise<number>;
}

export class AnnouncementServiceError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR",
    message: string
  ) {
    super(message);
  }
}

export class AnnouncementService {
  constructor(
    private readonly options: {
      repository: AnnouncementRepositoryPort;
      audit: AuditWriter;
      now?: () => Date;
    }
  ) {}

  async publish(input: { adminAccountId: string; body: string }): Promise<ChatMessageDto> {
    const body = input.body.trim();
    if (!body || [...body].length > SYSTEM_ANNOUNCEMENT_MAX_CHARS) {
      throw new AnnouncementServiceError("VALIDATION_ERROR", "公告内容长度不合法。");
    }

    const createdAt = this.options.now?.() ?? new Date();
    const announcement = await this.options.repository.createSystemAnnouncement({
      adminAccountId: input.adminAccountId,
      body,
      createdAt
    });
    await this.options.repository.writePublicSyncEvent({
      eventType: "system.announcement",
      payload: { announcementId: announcement.id, severity: announcement.severity },
      source: "admin"
    });
    await this.options.audit.write({
      actorAccountId: input.adminAccountId,
      action: "system_announcement.publish",
      targetType: "system_announcement",
      targetId: announcement.id,
      reason: body,
      metadata: { severity: announcement.severity }
    });

    return toSystemChatDto(announcement);
  }
}

export function toSystemChatDto(announcement: SystemAnnouncementRecord): ChatMessageDto {
  return {
    id: announcement.id,
    characterId: "system",
    characterName: "系统公告",
    kind: "system",
    channel: "lobby",
    body: announcement.body,
    createdAt: announcement.createdAt.toISOString()
  };
}
