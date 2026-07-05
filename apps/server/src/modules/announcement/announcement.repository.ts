import type { Db } from "../../db/client.js";
import { syncEvents, systemAnnouncements } from "../../db/schema.js";
import type {
  AnnouncementRepositoryPort,
  SystemAnnouncementRecord
} from "./announcement.service.js";

type AnnouncementDb = Pick<Db, "insert" | "select">;

export class AnnouncementRepository implements AnnouncementRepositoryPort {
  constructor(private readonly db: AnnouncementDb) {}

  async createSystemAnnouncement(input: {
    adminAccountId: string;
    body: string;
    createdAt: Date;
  }): Promise<SystemAnnouncementRecord> {
    const [row] = await this.db
      .insert(systemAnnouncements)
      .values({
        adminAccountId: input.adminAccountId,
        body: input.body,
        severity: "info",
        createdAt: input.createdAt
      })
      .returning({
        id: systemAnnouncements.id,
        adminAccountId: systemAnnouncements.adminAccountId,
        body: systemAnnouncements.body,
        severity: systemAnnouncements.severity,
        createdAt: systemAnnouncements.createdAt
      });

    if (!row) throw new Error("Failed to create system announcement");
    return normalizeAnnouncement(row);
  }

  async writePublicSyncEvent(input: {
    eventType: "system.announcement";
    payload: { announcementId: string; severity: "info" };
    source: "admin";
  }): Promise<number> {
    const [row] = await this.db
      .insert(syncEvents)
      .values({
        audience: "public",
        eventType: input.eventType,
        stateDirty: false,
        payload: input.payload,
        source: input.source
      })
      .returning({ id: syncEvents.id });

    if (!row) throw new Error("Failed to write system announcement sync event");
    return row.id;
  }
}

function normalizeAnnouncement(row: {
  id: string;
  adminAccountId: string;
  body: string;
  severity: string;
  createdAt: Date;
}): SystemAnnouncementRecord {
  return {
    id: row.id,
    adminAccountId: row.adminAccountId,
    body: row.body,
    severity: "info",
    createdAt: row.createdAt
  };
}
