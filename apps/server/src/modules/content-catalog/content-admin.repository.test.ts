import { describe, expect, it } from "vitest";
import type { NodePgClient } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { DEFAULT_BASE_CONTENT_RELEASE, type ContentRobotTemplate } from "@ai-mud/content";
import type { Db } from "../../db/client.js";
import { loadReleaseCatalog } from "./catalog-db.loader.js";
import type { ContentAdminTx, ContentDraftInsertValues } from "./content-admin.repository.js";
import { ContentAdminRepository } from "./content-admin.repository.js";

// M13-A 仓储用例：真实 drizzle 查询构建 + 假 pg 客户端（内存行存储），
// 照抄 base.repository.test.ts 的 FakePgClient 模式。覆盖：drafts CRUD 的 SQL 守卫
// （update/delete 仅命中 status='draft'）、max revision 过滤、list 排序、release
// onConflictDoNothing 幂等、listReleases 倒序，以及 catalog-db.loader 的命中装载
// 与显式内置 fallback。真库并发/约束语义由 M13-Q 真 PG 验收另行覆盖。

const NOW = new Date("2026-09-19T12:00:00.000Z");

function asTime(value: unknown): number {
  return new Date(value as string | number | Date).getTime();
}

// 迷你查询引擎：按 SQL 文本路由到内存表；行以 snake_case 列存储，
// select 投影按 SQL 列序映射为数组行（rowMode: "array"）。
class FakePgClient {
  queries: Array<{ text: string; params: unknown[] }> = [];
  drafts: Array<Record<string, unknown>> = [];
  releases: Array<Record<string, unknown>> = [];
  private counter = 0;

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  async query(config: { text: string }, params: unknown[]): Promise<{
    rows: unknown[][];
    rowCount: number;
    fields: unknown[];
  }> {
    const text = config.text;
    this.queries.push({ text, params });

    if (text.startsWith("select")) {
      let rows: Array<Record<string, unknown>> = [];
      if (/from "content_drafts"/.test(text)) {
        rows = [...this.drafts];
        if (/"kind" = \$/.test(text) && /"stable_id" = \$/.test(text)) {
          rows = rows.filter((draft) => draft.kind === params[0] && draft.stable_id === params[1]);
        }
        if (/"id" = \$/.test(text)) {
          rows = rows.filter((draft) => draft.id === params[0]);
        }
        if (/order by/.test(text)) {
          rows.sort(
            (a, b) =>
              String(a.kind).localeCompare(String(b.kind)) || asTime(a.updated_at) - asTime(b.updated_at)
          );
        }
      } else if (/from "content_releases"/.test(text)) {
        rows = [...this.releases];
        if (/"release_id" = \$/.test(text)) {
          rows = rows.filter((release) => release.release_id === params[0]);
        }
        if (/"created_at" desc/.test(text)) {
          rows.sort((a, b) => asTime(b.created_at) - asTime(a.created_at));
        }
      }
      if (/\blimit\s+1\b/.test(text)) rows = rows.slice(0, 1);
      return { rows: this.project(text, rows), rowCount: rows.length, fields: [] };
    }

    if (text.startsWith('insert into "content_drafts"')) {
      const record: Record<string, unknown> = {
        id: this.nextId("draft"),
        kind: params[0],
        stable_id: params[1],
        revision: params[2],
        payload: params[3],
        status: "draft",
        created_at: params[4],
        updated_at: params[5]
      };
      this.drafts.push(record);
      return { rows: [[record.id]], rowCount: 1, fields: [] };
    }

    if (text.startsWith('insert into "content_releases"')) {
      const releaseId = params[0];
      if (this.releases.some((release) => release.release_id === releaseId)) {
        return { rows: [], rowCount: 0, fields: [] }; // on conflict do nothing 命中
      }
      const record: Record<string, unknown> = {
        id: this.nextId("release"),
        release_id: releaseId,
        payload: params[1],
        content_hash: params[2],
        definition_count: params[3],
        published_by: params[4],
        created_at: NOW
      };
      this.releases.push(record);
      return { rows: [[record.id]], rowCount: 1, fields: [] };
    }

    if (text.startsWith('update "content_drafts"')) {
      if (/set "payload"/.test(text)) {
        // updateDraftPayload：set[payload, updated_at] + where[id, status='draft']
        const record = this.drafts.find(
          (draft) => draft.id === params[2] && draft.status === params[3]
        );
        if (record === undefined) return { rows: [], rowCount: 0, fields: [] };
        record.payload = params[0];
        record.updated_at = params[1];
        return { rows: [], rowCount: 1, fields: [] };
      }
      if (/set "status"/.test(text)) {
        // markDraftsPublished：set[status='published', updated_at] + where[status='draft']
        let count = 0;
        for (const draft of this.drafts) {
          if (draft.status === params[2]) {
            draft.status = params[0];
            draft.updated_at = params[1];
            count += 1;
          }
        }
        return { rows: [], rowCount: count, fields: [] };
      }
    }

    if (text.startsWith('delete from "content_drafts"')) {
      const index = this.drafts.findIndex(
        (draft) => draft.id === params[0] && draft.status === params[1]
      );
      if (index < 0) return { rows: [], rowCount: 0, fields: [] };
      this.drafts.splice(index, 1);
      return { rows: [], rowCount: 1, fields: [] };
    }

    return { rows: [], rowCount: 0, fields: [] };
  }

  // 从 SQL 的 select 列表取列名（兼容 "table"."col" 限定），映射内存行为数组行。
  private project(text: string, rows: Array<Record<string, unknown>>): unknown[][] {
    const match = /^select\s+([\s\S]+?)\s+from\s/.exec(text);
    if (!match) return rows.map((row) => Object.values(row));
    const columns = (match[1] ?? "").split(",").map((piece) => {
      const quoted = piece.trim().match(/"([^"]+)"/g) ?? [];
      const last = quoted.at(-1) ?? '""';
      return last.slice(1, -1);
    });
    return rows.map((row) => columns.map((column) => row[column] ?? null));
  }
}

function createRepository() {
  const client = new FakePgClient();
  const db = drizzle(client as unknown as NodePgClient);
  const repo = new ContentAdminRepository(db as unknown as ContentAdminTx);
  return { client, repo, db };
}

function draftValues(overrides: Partial<ContentDraftInsertValues> = {}): ContentDraftInsertValues {
  return {
    kind: "robot_template",
    stableId: "yd-x1",
    revision: 1,
    payload: { ref: { kind: "robot_template", stableId: "yd-x1", revision: 1 } },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function seedDraft(repo: ContentAdminRepository, overrides: Partial<ContentDraftInsertValues> = {}) {
  return repo.insertDraft(draftValues(overrides));
}

function newRobotPayload(stableId = "yd-x1"): Record<string, unknown> {
  return {
    ref: { kind: "robot_template", stableId, revision: 1 },
    name: "工坊试验车",
    groupId: "transport",
    description: "内容工坊发布的新型驮运机器人。",
    batteryCapacityWh: 9000,
    chargeRateW: 1500,
    workRatePerTick: 1
  };
}

describe("ContentAdminRepository drafts", () => {
  it("inserts a draft with a generated id and reads it back by id", async () => {
    const { repo } = createRepository();
    const payload = newRobotPayload();
    const record = await seedDraft(repo, { payload });

    expect(record.id).toBe("draft-1");
    expect(record.status).toBe("draft");
    expect(record.payload).toBe(payload);

    const found = await repo.findDraftById(record.id);
    expect(found).not.toBeNull();
    expect(found).toMatchObject({
      kind: "robot_template",
      stableId: "yd-x1",
      revision: 1,
      status: "draft"
    });
    expect(await repo.findDraftById("missing")).toBeNull();
  });

  it("scopes findMaxRevision to the same kind and stableId", async () => {
    const { repo } = createRepository();
    await seedDraft(repo, { stableId: "yd-x1", revision: 1 });
    await seedDraft(repo, { stableId: "yd-x1", revision: 3, updatedAt: new Date(NOW.getTime() + 1) });
    await seedDraft(repo, { kind: "recipe", stableId: "yd-x1", revision: 9 });

    expect(await repo.findMaxRevision("robot_template", "yd-x1")).toBe(3);
    expect(await repo.findMaxRevision("recipe", "yd-x1")).toBe(9);
    expect(await repo.findMaxRevision("project", "yd-x1")).toBe(0);
  });

  it("lists drafts sorted by kind then updatedAt", async () => {
    const { repo } = createRepository();
    const later = new Date(NOW.getTime() + 5_000);
    await seedDraft(repo, { kind: "recipe", stableId: "r-2", updatedAt: NOW });
    await seedDraft(repo, { stableId: "yd-x1", updatedAt: NOW });
    await seedDraft(repo, { kind: "recipe", stableId: "r-1", updatedAt: later });
    await seedDraft(repo, { kind: "project", stableId: "p-1", updatedAt: NOW });

    const drafts = await repo.listDrafts();
    expect(drafts.map((draft) => `${draft.kind}:${draft.stableId}`)).toEqual([
      "project:p-1",
      "recipe:r-2",
      "recipe:r-1",
      "robot_template:yd-x1"
    ]);
  });

  it("updates the payload only while the row is a draft", async () => {
    const { repo } = createRepository();
    const draft = await seedDraft(repo);
    await seedDraft(repo, { stableId: "yd-x2" });

    expect(await repo.updateDraftPayload(draft.id, newRobotPayload("yd-x1-v2"), NOW)).toBe(true);
    expect((await repo.findDraftById(draft.id))!.payload).toEqual(newRobotPayload("yd-x1-v2"));

    // 已发布行守卫：0 行受影响。
    const published = await seedDraft(repo, { stableId: "yd-x3" });
    await repo.markDraftsPublished(NOW);
    expect(await repo.updateDraftPayload(published.id, { hacked: true }, NOW)).toBe(false);
    expect((await repo.findDraftById(published.id))!.payload).toEqual(
      draftValues({ stableId: "yd-x3" }).payload
    );
    expect(await repo.updateDraftPayload("missing", { hacked: true }, NOW)).toBe(false);
  });

  it("deletes only drafts and reports affected rows", async () => {
    const { repo } = createRepository();
    const published = await seedDraft(repo, { stableId: "yd-pub" });
    await repo.markDraftsPublished(NOW);
    const keep = await seedDraft(repo, { stableId: "yd-keep" });

    expect(await repo.deleteDraftById(published.id)).toBe(false);
    expect(await repo.listDrafts()).toHaveLength(2);

    expect(await repo.deleteDraftById(keep.id)).toBe(true);
    expect(await repo.findDraftById(keep.id)).toBeNull();
    expect(await repo.deleteDraftById(keep.id)).toBe(false);
  });

  it("marks all draft rows published exactly once", async () => {
    const { repo } = createRepository();
    await seedDraft(repo, { stableId: "a" });
    await seedDraft(repo, { stableId: "b" });
    await seedDraft(repo, { stableId: "c" });

    expect(await repo.markDraftsPublished(NOW)).toBe(3);
    expect(await repo.markDraftsPublished(NOW)).toBe(0);
    const drafts = await repo.listDrafts();
    expect(drafts.every((draft) => draft.status === "published")).toBe(true);
  });
});

describe("ContentAdminRepository releases", () => {
  it("inserts a release once and treats a repeated release_id as a no-op", async () => {
    const { repo } = createRepository();
    const payload = {
      ...DEFAULT_BASE_CONTENT_RELEASE,
      robots: [...DEFAULT_BASE_CONTENT_RELEASE.robots, newRobotPayload() as unknown as ContentRobotTemplate]
    };
    const values = {
      releaseId: "workshop-abc123",
      payload,
      contentHash: "f".repeat(64),
      definitionCount: 7,
      publishedBy: "acc-admin-1"
    };

    expect(await repo.insertRelease(values)).toBe(true);
    expect(await repo.insertRelease(values)).toBe(false);

    const found = await repo.findReleaseByReleaseId("workshop-abc123");
    expect(found).not.toBeNull();
    expect(found).toMatchObject({
      contentHash: "f".repeat(64),
      definitionCount: 7,
      publishedBy: "acc-admin-1"
    });
    expect(await repo.findReleaseByReleaseId("workshop-none")).toBeNull();
  });

  it("lists releases newest first", async () => {
    const { client, repo } = createRepository();
    const payload = { ...DEFAULT_BASE_CONTENT_RELEASE };
    const older = new Date(NOW.getTime() - 60_000);
    await repo.insertRelease({
      releaseId: "workshop-first",
      payload,
      contentHash: "hash-1",
      definitionCount: 6,
      publishedBy: null
    });
    client.releases[0]!.created_at = older;
    await repo.insertRelease({
      releaseId: "workshop-second",
      payload,
      contentHash: "hash-2",
      definitionCount: 7,
      publishedBy: null
    });

    const releases = await repo.listReleases();
    expect(releases.map((release) => release.releaseId)).toEqual(["workshop-second", "workshop-first"]);
  });
});

describe("loadReleaseCatalog", () => {
  it("loads a stored workshop release and exposes its definitions", async () => {
    const { repo, db } = createRepository();
    const releaseId = "workshop-loader1";
    const payload = {
      ...DEFAULT_BASE_CONTENT_RELEASE,
      releaseId,
      robots: [
        ...DEFAULT_BASE_CONTENT_RELEASE.robots,
        newRobotPayload("yd-x1") as unknown as ContentRobotTemplate
      ],
      provisionSeed: { ...DEFAULT_BASE_CONTENT_RELEASE.provisionSeed, releaseId }
    };
    await repo.insertRelease({
      releaseId,
      payload,
      contentHash: "hash-loader",
      definitionCount: 7,
      publishedBy: null
    });

    const catalog = await loadReleaseCatalog(db as unknown as Pick<Db, "select">, releaseId);
    expect(catalog.releaseId()).toBe(releaseId);
    expect(catalog.getRobotTemplate("yd-x1")).not.toBeNull();
    expect(catalog.getRobotTemplate("yd-h1")).not.toBeNull();
  });

  it("falls back to the built-in release when the id is not stored (contract §3 explicit fallback)", async () => {
    const { db } = createRepository();
    const catalog = await loadReleaseCatalog(db as unknown as Pick<Db, "select">, "yudian-base-0");
    expect(catalog.releaseId()).toBe(DEFAULT_BASE_CONTENT_RELEASE.releaseId);
    expect(catalog.getRecipeTemplate("manufacture-yd-h1")).not.toBeNull();
  });
});
