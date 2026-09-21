import { and, asc, desc, eq } from "drizzle-orm";
import type { ContentBaseRelease } from "@ai-mud/content";
import type { ContentDefinitionKind, DraftStatus } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { contentDrafts, contentReleases } from "../../db/schema.js";

// M13-A 内容工坊持久层（content_drafts / content_releases，m13-p-contract.md §2）。
// 透传模式与 base.repository.ts 相同：构造函数收 Db 或 tx，方法必须在调用方事务内
// 执行；repo 自身绝不开启或提交事务。release 不可变：本文件只提供 onConflictDoNothing
// 的首插，不提供任何 release 更新/删除路径。
//
// draft 语义：insert 固定 status='draft'；update/delete 以 status='draft' 为 where 守卫，
// 命中已发布行一律 0 行受影响（由 service 判定 CONFLICT）。revision 唯一性由
// content_drafts_kind_stable_rev_idx 兜底，service 先读 max(revision)+1。

export type ContentAdminTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export interface ContentDraftRecord {
  id: string;
  kind: ContentDefinitionKind;
  stableId: string;
  revision: number;
  payload: Record<string, unknown>;
  status: DraftStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentDraftInsertValues {
  kind: ContentDefinitionKind;
  stableId: string;
  revision: number;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentReleaseRecord {
  id: string;
  releaseId: string;
  payload: ContentBaseRelease;
  contentHash: string;
  definitionCount: number;
  publishedBy: string | null;
  createdAt: Date;
}

export interface ContentReleaseInsertValues {
  releaseId: string;
  payload: ContentBaseRelease;
  contentHash: string;
  definitionCount: number;
  publishedBy: string | null;
}

function toDraftRecord(row: {
  id: string;
  kind: string;
  stableId: string;
  revision: number;
  payload: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): ContentDraftRecord {
  return {
    id: row.id,
    kind: row.kind as ContentDefinitionKind,
    stableId: row.stableId,
    revision: row.revision,
    payload: row.payload as Record<string, unknown>,
    status: row.status as DraftStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toReleaseRecord(row: {
  id: string;
  releaseId: string;
  payload: unknown;
  contentHash: string;
  definitionCount: number;
  publishedBy: string | null;
  createdAt: Date;
}): ContentReleaseRecord {
  return { ...row, payload: row.payload as ContentBaseRelease };
}

export class ContentAdminRepository {
  // tx 透传构造：实例绑定调用方事务；forTransaction 换绑（与 BaseRepository 一致）。
  constructor(private readonly db: ContentAdminTx) {}

  forTransaction(tx: ContentAdminTx): ContentAdminRepository {
    return new ContentAdminRepository(tx);
  }

  // ---------- content_drafts ----------

  // 全量草稿（含已发布），按 kind / updated_at 升序；publish 合并顺序与此一致。
  async listDrafts(): Promise<ContentDraftRecord[]> {
    const rows = await this.db
      .select({
        id: contentDrafts.id,
        kind: contentDrafts.kind,
        stableId: contentDrafts.stableId,
        revision: contentDrafts.revision,
        payload: contentDrafts.payload,
        status: contentDrafts.status,
        createdAt: contentDrafts.createdAt,
        updatedAt: contentDrafts.updatedAt
      })
      .from(contentDrafts)
      .orderBy(asc(contentDrafts.kind), asc(contentDrafts.updatedAt));
    return rows.map(toDraftRecord);
  }

  async findDraftById(draftId: string): Promise<ContentDraftRecord | null> {
    const rows = await this.db
      .select({
        id: contentDrafts.id,
        kind: contentDrafts.kind,
        stableId: contentDrafts.stableId,
        revision: contentDrafts.revision,
        payload: contentDrafts.payload,
        status: contentDrafts.status,
        createdAt: contentDrafts.createdAt,
        updatedAt: contentDrafts.updatedAt
      })
      .from(contentDrafts)
      .where(eq(contentDrafts.id, draftId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toDraftRecord(row);
  }

  // 同 (kind, stableId) 现存最大 revision（含已发布行）；无行返回 0。
  async findMaxRevision(kind: ContentDefinitionKind, stableId: string): Promise<number> {
    const rows = await this.db
      .select({ revision: contentDrafts.revision })
      .from(contentDrafts)
      .where(and(eq(contentDrafts.kind, kind), eq(contentDrafts.stableId, stableId)));
    return rows.reduce((max, row) => Math.max(max, row.revision), 0);
  }

  async insertDraft(values: ContentDraftInsertValues): Promise<ContentDraftRecord> {
    const rows = await this.db
      .insert(contentDrafts)
      .values({
        kind: values.kind,
        stableId: values.stableId,
        revision: values.revision,
        payload: values.payload,
        createdAt: values.createdAt,
        updatedAt: values.updatedAt
      })
      .returning({ id: contentDrafts.id });
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("content_drafts insert returned no id");
    return {
      id,
      kind: values.kind,
      stableId: values.stableId,
      revision: values.revision,
      payload: values.payload,
      status: "draft",
      createdAt: values.createdAt,
      updatedAt: values.updatedAt
    };
  }

  // 仅替换 status='draft' 行的 payload；已发布行 0 行受影响 → false。
  async updateDraftPayload(
    draftId: string,
    payload: Record<string, unknown>,
    now: Date
  ): Promise<boolean> {
    const result = await this.db
      .update(contentDrafts)
      .set({ payload, updatedAt: now })
      .where(and(eq(contentDrafts.id, draftId), eq(contentDrafts.status, "draft")));
    return (result.rowCount ?? 0) > 0;
  }

  // 仅删除 status='draft' 行；已发布行 0 行受影响 → false。
  async deleteDraftById(draftId: string): Promise<boolean> {
    const result = await this.db
      .delete(contentDrafts)
      .where(and(eq(contentDrafts.id, draftId), eq(contentDrafts.status, "draft")));
    return (result.rowCount ?? 0) > 0;
  }

  // 把全部 draft 行标记 published（发布事务收尾步骤），返回受影响行数。
  async markDraftsPublished(now: Date): Promise<number> {
    const result = await this.db
      .update(contentDrafts)
      .set({ status: "published", updatedAt: now })
      .where(eq(contentDrafts.status, "draft"));
    return result.rowCount ?? 0;
  }

  // ---------- content_releases（不可变，只插） ----------

  // release_id 冲突时 do nothing → false（同 hash 重复发布走回读既有行）。
  async insertRelease(values: ContentReleaseInsertValues): Promise<boolean> {
    const rows = await this.db
      .insert(contentReleases)
      .values({
        releaseId: values.releaseId,
        payload: values.payload,
        contentHash: values.contentHash,
        definitionCount: values.definitionCount,
        publishedBy: values.publishedBy
      })
      .onConflictDoNothing({ target: contentReleases.releaseId })
      .returning({ id: contentReleases.id });
    return rows.length > 0;
  }

  async findReleaseByReleaseId(releaseId: string): Promise<ContentReleaseRecord | null> {
    const rows = await this.db
      .select({
        id: contentReleases.id,
        releaseId: contentReleases.releaseId,
        payload: contentReleases.payload,
        contentHash: contentReleases.contentHash,
        definitionCount: contentReleases.definitionCount,
        publishedBy: contentReleases.publishedBy,
        createdAt: contentReleases.createdAt
      })
      .from(contentReleases)
      .where(eq(contentReleases.releaseId, releaseId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toReleaseRecord(row);
  }

  // 管理端发布历史：最新在前。
  async listReleases(): Promise<ContentReleaseRecord[]> {
    const rows = await this.db
      .select({
        id: contentReleases.id,
        releaseId: contentReleases.releaseId,
        payload: contentReleases.payload,
        contentHash: contentReleases.contentHash,
        definitionCount: contentReleases.definitionCount,
        publishedBy: contentReleases.publishedBy,
        createdAt: contentReleases.createdAt
      })
      .from(contentReleases)
      .orderBy(desc(contentReleases.createdAt));
    return rows.map(toReleaseRecord);
  }
}
