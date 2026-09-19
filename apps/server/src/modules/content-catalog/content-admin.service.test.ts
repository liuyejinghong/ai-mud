import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_CONTENT_RELEASE } from "@ai-mud/content";
import type {
  ContentDefinitionKind,
  CreateContentDraftInputDto,
  UpdateContentDraftInputDto
} from "@ai-mud/shared";
import type {
  ContentAdminTx,
  ContentDraftInsertValues,
  ContentDraftRecord,
  ContentReleaseInsertValues,
  ContentReleaseRecord
} from "./content-admin.repository.js";
import {
  BaseOperationError,
  ContentAdminService,
  type ContentAdminPrincipal,
  type ContentAdminRepoPort
} from "./content-admin.service.js";

// M13-A 服务用例：内存假仓储锁业务语义（合同 m13-p-contract.md §3 管理员内容接口）。
// 覆盖：draft CRUD（revision 递增 / payload 原样 / 仅 draft 可改删）、list 排序、
// publish 成功合并（内置 + 覆盖 + 追加）、hash 公式与 releaseId 派生、同内容重复
// 发布幂等（duplicate）、校验失败收集全部错误且零写入、整包交叉校验、FORBIDDEN。
// 真库行为由 content-admin.repository.test.ts（假 pg client）与 M13-Q 真库验收覆盖。

const NOW = new Date("2026-09-19T12:00:00.000Z");

const ADMIN: ContentAdminPrincipal = { accountId: "acc-admin-1", role: "admin" };
const TX = {} as ContentAdminTx;

// ---------- 内存假仓储 ----------

class FakeContentAdminRepo implements ContentAdminRepoPort {
  drafts: ContentDraftRecord[] = [];
  releases: ContentReleaseRecord[] = [];
  insertReleaseCalls: ContentReleaseInsertValues[] = [];
  private seq = 0;

  async listDrafts(): Promise<ContentDraftRecord[]> {
    return [...this.drafts].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.updatedAt.getTime() - b.updatedAt.getTime()
    );
  }

  async findDraftById(draftId: string): Promise<ContentDraftRecord | null> {
    return this.drafts.find((draft) => draft.id === draftId) ?? null;
  }

  async findMaxRevision(kind: ContentDefinitionKind, stableId: string): Promise<number> {
    return this.drafts
      .filter((draft) => draft.kind === kind && draft.stableId === stableId)
      .reduce((max, draft) => Math.max(max, draft.revision), 0);
  }

  async insertDraft(values: ContentDraftInsertValues): Promise<ContentDraftRecord> {
    this.seq += 1;
    const record: ContentDraftRecord = {
      id: `draft-${this.seq}`,
      status: "draft",
      ...values
    };
    this.drafts.push(record);
    return record;
  }

  async updateDraftPayload(
    draftId: string,
    payload: Record<string, unknown>,
    now: Date
  ): Promise<boolean> {
    const draft = this.drafts.find((d) => d.id === draftId && d.status === "draft");
    if (draft === undefined) return false;
    draft.payload = payload;
    draft.updatedAt = now;
    return true;
  }

  async deleteDraftById(draftId: string): Promise<boolean> {
    const index = this.drafts.findIndex((d) => d.id === draftId && d.status === "draft");
    if (index < 0) return false;
    this.drafts.splice(index, 1);
    return true;
  }

  async markDraftsPublished(now: Date): Promise<number> {
    let count = 0;
    for (const draft of this.drafts) {
      if (draft.status === "draft") {
        draft.status = "published";
        draft.updatedAt = now;
        count += 1;
      }
    }
    return count;
  }

  async insertRelease(values: ContentReleaseInsertValues): Promise<boolean> {
    this.insertReleaseCalls.push(values);
    if (this.releases.some((release) => release.releaseId === values.releaseId)) {
      return false;
    }
    this.seq += 1;
    const record: ContentReleaseRecord = {
      id: `release-${this.seq}`,
      createdAt: NOW,
      ...values
    };
    this.releases.push(record);
    return true;
  }

  async findReleaseByReleaseId(releaseId: string): Promise<ContentReleaseRecord | null> {
    return this.releases.find((release) => release.releaseId === releaseId) ?? null;
  }

  async listReleases(): Promise<ContentReleaseRecord[]> {
    return [...this.releases].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

function createService() {
  const repo = new FakeContentAdminRepo();
  const service = new ContentAdminService(() => repo, { now: () => NOW });
  return { repo, service };
}

// ---------- fixture ----------

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

function overrideRecipePayload(): Record<string, unknown> {
  return {
    ref: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 2 },
    name: "制造驮运机器人（改进）",
    description: "降低单台工作量的改进配方。",
    inputs: [
      { itemId: "support_frame", quantity: 4 },
      { itemId: "spare_parts", quantity: 6 },
      { itemId: "power_box", quantity: 1 }
    ],
    workPerUnit: 25,
    output: { templateStableId: "yd-h1", initialBatteryWh: 12000 }
  };
}

function createDraftInput(
  kind: string,
  stableId: string,
  payload: Record<string, unknown>
): CreateContentDraftInputDto {
  // kind 以 string 传入是为了让测试能构造非法值（service 运行时校验兜底）。
  return { kind: kind as ContentDefinitionKind, stableId, payload };
}

async function expectOperationError(
  promise: Promise<unknown>,
  code: string,
  messageFragments: string[] = []
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BaseOperationError);
  const error = caught as BaseOperationError;
  expect(error.code).toBe(code);
  for (const fragment of messageFragments) {
    expect(error.message).toContain(fragment);
  }
}

// ---------- 用例 ----------

describe("ContentAdminService drafts CRUD", () => {
  it("createDraft assigns max revision + 1 per (kind, stableId) and stores the payload as-is", async () => {
    const { repo, service } = createService();
    const payload = newRobotPayload();

    const first = await service.createDraft(TX, ADMIN, createDraftInput("robot_template", "yd-x1", payload));
    expect(first.revision).toBe(1);
    expect(first.status).toBe("draft");
    expect(first.payload).toEqual(payload);
    expect(first.updatedAt).toBe(NOW.toISOString());

    const second = await service.createDraft(TX, ADMIN, createDraftInput("robot_template", "yd-x1", payload));
    expect(second.revision).toBe(2);

    const other = await service.createDraft(TX, ADMIN, createDraftInput("robot_template", "yd-x2", payload));
    expect(other.revision).toBe(1);

    // 已发布行也计入 max revision（在途工单持旧修订的前提：revision 只增不减）。
    repo.drafts[0]!.status = "published";
    const third = await service.createDraft(TX, ADMIN, createDraftInput("robot_template", "yd-x1", payload));
    expect(third.revision).toBe(3);
  });

  it("createDraft rejects unknown kinds and empty stableIds", async () => {
    const { repo, service } = createService();
    await expectOperationError(
      service.createDraft(TX, ADMIN, createDraftInput("facility", "f-1", {})),
      "VALIDATION_ERROR",
      ["kind"]
    );
    await expectOperationError(
      service.createDraft(TX, ADMIN, createDraftInput("recipe", "", {})),
      "VALIDATION_ERROR",
      ["stableId"]
    );
    expect(repo.drafts).toHaveLength(0);
  });

  it("updateDraft replaces the payload only while the draft is unpublished", async () => {
    const { repo, service } = createService();
    const created = await service.createDraft(TX, ADMIN, createDraftInput("recipe", "r-1", { v: 1 }));

    const replacement = { v: 2, extra: { nested: true } };
    const input: UpdateContentDraftInputDto = { draftId: created.draftId, payload: replacement };
    const updated = await service.updateDraft(TX, ADMIN, input);
    expect(updated.payload).toEqual(replacement);
    expect(updated.updatedAt).toBe(NOW.toISOString());
    expect(repo.drafts[0]!.payload).toEqual(replacement);

    repo.drafts[0]!.status = "published";
    await expectOperationError(
      service.updateDraft(TX, ADMIN, { draftId: created.draftId, payload: { v: 3 } }),
      "CONFLICT"
    );
    await expectOperationError(
      service.updateDraft(TX, ADMIN, { draftId: "missing", payload: { v: 4 } }),
      "VALIDATION_ERROR"
    );
  });

  it("deleteDraft removes only unpublished drafts", async () => {
    const { repo, service } = createService();
    const created = await service.createDraft(TX, ADMIN, createDraftInput("project", "p-1", { v: 1 }));

    await expectOperationError(service.deleteDraft(TX, ADMIN, "missing"), "VALIDATION_ERROR");

    repo.drafts[0]!.status = "published";
    await expectOperationError(service.deleteDraft(TX, ADMIN, created.draftId), "CONFLICT");
    expect(repo.drafts).toHaveLength(1);

    repo.drafts[0]!.status = "draft";
    const result = await service.deleteDraft(TX, ADMIN, created.draftId);
    expect(result).toEqual({ draftId: created.draftId, deleted: true });
    expect(repo.drafts).toHaveLength(0);
  });

  it("listDrafts sorts by kind then updatedAt and maps DTO fields", async () => {
    const { repo, service } = createService();
    const older = new Date(NOW.getTime() - 5_000);
    repo.drafts.push(
      {
        id: "d-1",
        kind: "robot_template",
        stableId: "yd-x1",
        revision: 1,
        payload: {},
        status: "draft",
        createdAt: older,
        updatedAt: NOW
      },
      {
        id: "d-2",
        kind: "recipe",
        stableId: "r-1",
        revision: 1,
        payload: {},
        status: "draft",
        createdAt: older,
        updatedAt: NOW
      },
      {
        id: "d-3",
        kind: "recipe",
        stableId: "r-2",
        revision: 1,
        payload: {},
        status: "published",
        createdAt: older,
        updatedAt: older
      },
      {
        id: "d-4",
        kind: "project",
        stableId: "p-1",
        revision: 1,
        payload: {},
        status: "draft",
        createdAt: older,
        updatedAt: older
      }
    );

    const drafts = await service.listDrafts(TX, ADMIN);
    expect(drafts.map((draft) => draft.draftId)).toEqual(["d-4", "d-3", "d-2", "d-1"]);
    expect(drafts[0]).toMatchObject({ kind: "project", status: "draft", updatedAt: older.toISOString() });
    expect(drafts[1]).toMatchObject({ kind: "recipe", status: "published" });
  });
});

describe("ContentAdminService publish", () => {
  it("publishes the merged package, derives the release id from the content hash, and consumes drafts", async () => {
    const { repo, service } = createService();
    const robotPayload = newRobotPayload();
    const recipePayload = overrideRecipePayload();
    await service.createDraft(TX, ADMIN, createDraftInput("recipe", "manufacture-yd-h1", recipePayload));
    await service.createDraft(TX, ADMIN, createDraftInput("robot_template", "yd-x1", robotPayload));

    const result = await service.publish(TX, ADMIN);

    // hash 公式：sha256(JSON.stringify(不含 releaseId 的整包本体))。
    const expectedBody = {
      itemNames: { ...DEFAULT_BASE_CONTENT_RELEASE.itemNames },
      robots: [...DEFAULT_BASE_CONTENT_RELEASE.robots, robotPayload],
      projects: [...DEFAULT_BASE_CONTENT_RELEASE.projects],
      recipes: [recipePayload, ...DEFAULT_BASE_CONTENT_RELEASE.recipes.slice(1)],
      orderTemplates: [...DEFAULT_BASE_CONTENT_RELEASE.orderTemplates],
      provisionSeed: { ...DEFAULT_BASE_CONTENT_RELEASE.provisionSeed }
    };
    const expectedHash = createHash("sha256").update(JSON.stringify(expectedBody)).digest("hex");
    expect(result.contentHash).toBe(expectedHash);
    expect(result.releaseId).toBe(`workshop-${expectedHash.slice(0, 12)}`);
    expect(result.duplicate).toBe(false);
    expect(result.definitionCount).toBe(
      DEFAULT_BASE_CONTENT_RELEASE.robots.length +
        DEFAULT_BASE_CONTENT_RELEASE.projects.length +
        DEFAULT_BASE_CONTENT_RELEASE.recipes.length +
        1
    );

    expect(repo.releases).toHaveLength(1);
    const stored = repo.insertReleaseCalls[0]!;
    // 追加与覆盖各就各位；seed.releaseId 对齐 workshop id（否则目录装载 fail-fast）。
    expect(stored.payload.releaseId).toBe(result.releaseId);
    expect(stored.payload.provisionSeed.releaseId).toBe(result.releaseId);
    expect(stored.payload.robots.at(-1)?.ref.stableId).toBe("yd-x1");
    expect(stored.payload.recipes[0]).toEqual(recipePayload);
    expect(stored.definitionCount).toBe(result.definitionCount);
    expect(stored.publishedBy).toBe(ADMIN.accountId);

    expect(repo.drafts.every((draft) => draft.status === "published")).toBe(true);
  });

  it("returns the existing release id with duplicate=true when the same content is published twice", async () => {
    const { repo, service } = createService();
    const payload = newRobotPayload();
    await service.createDraft(TX, ADMIN, createDraftInput("robot_template", "yd-x1", payload));
    const first = await service.publish(TX, ADMIN);

    // 同内容再次成稿（revision+1，payload 相同）→ 同 hash → 命中既有 release。
    await service.createDraft(TX, ADMIN, createDraftInput("robot_template", "yd-x1", payload));
    const second = await service.publish(TX, ADMIN);

    expect(second.duplicate).toBe(true);
    expect(second.releaseId).toBe(first.releaseId);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.definitionCount).toBe(first.definitionCount);
    expect(repo.releases).toHaveLength(1);
    expect(repo.releases[0]!.publishedBy).toBe(ADMIN.accountId);
  });

  it("collects every invalid definition into one CONTENT_INCOMPATIBLE error and writes nothing", async () => {
    const { repo, service } = createService();
    const badRobot = { ...newRobotPayload("bad-robot"), batteryCapacityWh: -1 };
    const badRecipe = {
      ref: { kind: "recipe", stableId: "bad-recipe", revision: 1 },
      name: "坏配方",
      description: "工作量非法。",
      inputs: [{ itemId: "spare_parts", quantity: 1 }],
      workPerUnit: 0,
      output: { templateStableId: "yd-h1", initialBatteryWh: 100 }
    };
    await service.createDraft(TX, ADMIN, createDraftInput("robot_template", "bad-robot", badRobot));
    await service.createDraft(TX, ADMIN, createDraftInput("recipe", "bad-recipe", badRecipe));

    await expectOperationError(service.publish(TX, ADMIN), "CONTENT_INCOMPATIBLE", [
      "bad-robot",
      "batteryCapacityWh",
      "bad-recipe",
      "workPerUnit"
    ]);

    // 零写入：无 release 落库、草稿保持 draft（调用方事务回滚后的最终状态）。
    expect(repo.insertReleaseCalls).toHaveLength(0);
    expect(repo.releases).toHaveLength(0);
    expect(repo.drafts.every((draft) => draft.status === "draft")).toBe(true);
  });

  it("rejects drafts that break whole-package invariants (itemNames / seed coverage)", async () => {
    const { repo, service } = createService();
    // 覆盖首个项目后引用 itemNames/开局库存都没有的新物料 → 整包交叉校验失败。
    const badProject = {
      ...DEFAULT_BASE_CONTENT_RELEASE.projects[0]!,
      ref: { kind: "project", stableId: "install-solar-array", revision: 2 },
      inputs: [{ itemId: "flux_capacitor", quantity: 1 }]
    };
    await service.createDraft(TX, ADMIN, createDraftInput("project", "install-solar-array", badProject));

    await expectOperationError(service.publish(TX, ADMIN), "CONTENT_INCOMPATIBLE", [
      "itemNames",
      "flux_capacitor"
    ]);
    expect(repo.insertReleaseCalls).toHaveLength(0);
  });

  it("overrides a built-in definition in place when a draft reuses its stableId", async () => {
    const { service, repo } = createService();
    const baseRobot = DEFAULT_BASE_CONTENT_RELEASE.robots[0]!;
    const override = { ...baseRobot, batteryCapacityWh: 12345 };
    await service.createDraft(
      TX,
      ADMIN,
      createDraftInput("robot_template", baseRobot.ref.stableId, override as unknown as Record<string, unknown>)
    );

    const result = await service.publish(TX, ADMIN);
    const stored = repo.insertReleaseCalls[0]!;
    expect(stored.payload.robots).toHaveLength(DEFAULT_BASE_CONTENT_RELEASE.robots.length);
    expect(stored.payload.robots[0]!.batteryCapacityWh).toBe(12345);
    expect(result.definitionCount).toBe(
      DEFAULT_BASE_CONTENT_RELEASE.robots.length +
        DEFAULT_BASE_CONTENT_RELEASE.projects.length +
        DEFAULT_BASE_CONTENT_RELEASE.recipes.length
    );
  });

  it("forbids non-admin principals on every operation without touching the repository", async () => {
    const { repo, service } = createService();
    const player: ContentAdminPrincipal = { accountId: "acc-2", role: "player" };

    await expectOperationError(service.listDrafts(TX, player), "FORBIDDEN");
    await expectOperationError(
      service.createDraft(TX, player, createDraftInput("recipe", "r-9", {})),
      "FORBIDDEN"
    );
    await expectOperationError(service.publish(TX, player), "FORBIDDEN");
    await expectOperationError(service.listReleases(TX, player), "FORBIDDEN");

    expect(repo.drafts).toHaveLength(0);
    expect(repo.insertReleaseCalls).toHaveLength(0);
  });

  it("lists releases newest first with summary DTO fields", async () => {
    const { repo, service } = createService();
    const older = new Date(NOW.getTime() - 60_000);
    const basePayload = { ...DEFAULT_BASE_CONTENT_RELEASE, releaseId: "workshop-a", provisionSeed: { ...DEFAULT_BASE_CONTENT_RELEASE.provisionSeed, releaseId: "workshop-a" } };
    repo.releases.push(
      {
        id: "rel-1",
        releaseId: "workshop-a",
        payload: basePayload,
        contentHash: "hash-a",
        definitionCount: 6,
        publishedBy: ADMIN.accountId,
        createdAt: older
      },
      {
        id: "rel-2",
        releaseId: "workshop-b",
        payload: basePayload,
        contentHash: "hash-b",
        definitionCount: 7,
        publishedBy: null,
        createdAt: NOW
      }
    );

    const releases = await service.listReleases(TX, ADMIN);
    expect(releases.map((release) => release.releaseId)).toEqual(["workshop-b", "workshop-a"]);
    expect(releases[0]).toEqual({
      releaseId: "workshop-b",
      contentHash: "hash-b",
      definitionCount: 7,
      createdAt: NOW.toISOString()
    });
    expect(releases[1]!.createdAt).toBe(older.toISOString());
  });
});
