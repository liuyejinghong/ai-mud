import { createHash } from "node:crypto";
import {
  DEFAULT_BASE_CONTENT_RELEASE,
  type ContentBaseRelease,
  type ContentItemInfo,
  type ContentOrderTemplate,
  type ContentProjectTemplate,
  type ContentProvisionSeed,
  type ContentRecipeTemplate,
  type ContentRobotTemplate,
  validateItemNames,
  validateOrderTemplate,
  validateProjectTemplate,
  validateProvisionSeed,
  validateRecipeTemplate,
  validateRobotTemplate
} from "@ai-mud/content";
import type {
  ContentDefinitionKind,
  ContentDraftDto,
  ContentReleaseSummaryDto,
  CreateContentDraftInputDto,
  ErrorCode,
  PublishContentReleaseResultDto,
  UpdateContentDraftInputDto
} from "@ai-mud/shared";
import { CONTENT_DEFINITION_KINDS } from "@ai-mud/shared";
import type {
  ContentAdminTx,
  ContentDraftInsertValues,
  ContentDraftRecord,
  ContentReleaseInsertValues,
  ContentReleaseRecord
} from "./content-admin.repository.js";

// M13-A 内容发布服务（m13-p-contract.md §3 管理员内容接口的业务语义）。
// tx 绑定：方法只接收调用方（application 用例）开好的事务，自身绝不开/提交事务；
// 仓储经 (tx) => repo 工厂换绑（与 construction.service 的 composition 注入同风格）。
// publish 流水线：合并整包（内置 release + 全部 draft）→ 整包校验（失败收集全部错误
// 抛 CONTENT_INCOMPATIBLE，事务回滚零写入）→ sha256 → 首插 content_releases →
// 草稿标记 published。release 不可变：重复内容 → 同 hash → 同 releaseId → 冲突
// do nothing → 回读既有行返回 duplicate。

// 领域错误：code 为 shared ErrorCode；形状与 base.service.ts 的 BaseOperationError
// 一致（transport 侧经 application/content-admin/usecases.ts 再导出识别）。
export class BaseOperationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = "BaseOperationError";
  }
}

// 管理员 principal（transport 从 admin 会话骨架映射；super_admin 视同 admin）。
export interface ContentAdminPrincipal {
  accountId: string;
  role: string;
}

export interface DeleteContentDraftResultDto {
  draftId: string;
  deleted: true;
}

// frozen DTO（PublishContentReleaseResultDto）之上的服务层附加位：同内容重复发布为 true。
export type PublishReleaseOutcome = PublishContentReleaseResultDto & { duplicate: boolean };

// 仓储结构端口：实现 = ContentAdminRepository；测试注入内存假仓储。
export interface ContentAdminRepoPort {
  listDrafts(): Promise<ContentDraftRecord[]>;
  findDraftById(draftId: string): Promise<ContentDraftRecord | null>;
  findMaxRevision(kind: ContentDefinitionKind, stableId: string): Promise<number>;
  insertDraft(values: ContentDraftInsertValues): Promise<ContentDraftRecord>;
  updateDraftPayload(draftId: string, payload: Record<string, unknown>, now: Date): Promise<boolean>;
  deleteDraftById(draftId: string): Promise<boolean>;
  markDraftsPublished(now: Date): Promise<number>;
  insertRelease(values: ContentReleaseInsertValues): Promise<boolean>;
  findReleaseByReleaseId(releaseId: string): Promise<ContentReleaseRecord | null>;
  listReleases(): Promise<ContentReleaseRecord[]>;
}

export type ContentAdminRepoProvider = (tx: ContentAdminTx) => ContentAdminRepoPort;

const WORKSHOP_RELEASE_PREFIX = "workshop-";
const RELEASE_ID_HASH_CHARS = 12;

function assertAdmin(principal: ContentAdminPrincipal): void {
  if (principal.role !== "admin" && principal.role !== "super_admin") {
    throw new BaseOperationError("FORBIDDEN", "内容工坊操作需要管理员角色。");
  }
}

function assertCreateInput(input: CreateContentDraftInputDto): void {
  if (!(CONTENT_DEFINITION_KINDS as readonly string[]).includes(input.kind)) {
    throw new BaseOperationError(
      "VALIDATION_ERROR",
      `kind 必须是 ${CONTENT_DEFINITION_KINDS.join("/")} 之一。`
    );
  }
  if (typeof input.stableId !== "string" || input.stableId.length === 0) {
    throw new BaseOperationError("VALIDATION_ERROR", "stableId 必须是非空字符串。");
  }
}

function toDraftDto(record: ContentDraftRecord): ContentDraftDto {
  return {
    draftId: record.id,
    kind: record.kind,
    stableId: record.stableId,
    revision: record.revision,
    payload: record.payload,
    status: record.status,
    updatedAt: record.updatedAt.toISOString()
  };
}

// 合并中间体：不含最终 releaseId（releaseId 由本体的 sha256 派生，先有 hash 后有 id）。
interface MergedPackageBody {
  itemNames: Record<string, unknown>;
  robots: ContentRobotTemplate[];
  projects: ContentProjectTemplate[];
  recipes: ContentRecipeTemplate[];
  orderTemplates: ContentOrderTemplate[];
  provisionSeed: ContentProvisionSeed;
}

function stableIdLabel(item: unknown): string {
  const ref = (item as { ref?: { stableId?: unknown } } | null)?.ref;
  const stableId = (ref as { stableId?: unknown } | null)?.stableId;
  return stableId === undefined ? "?" : String(stableId);
}

function upsertByStableId<T>(list: T[], draft: ContentDraftRecord): void {
  const payload = draft.payload as T;
  const index = list.findIndex((item) => stableIdLabel(item) === draft.stableId);
  if (index >= 0) {
    list[index] = payload;
  } else {
    list.push(payload);
  }
}

// 内置 release 为底，drafts 按 kind 覆盖同 stableId 项或追加；顺序 = 仓储排序
// （kind/updatedAt 升序），同 stableId 多修订时后写入的草稿胜出。
function mergePackage(drafts: readonly ContentDraftRecord[]): MergedPackageBody {
  const builtIn = DEFAULT_BASE_CONTENT_RELEASE;
  const body: MergedPackageBody = {
    itemNames: { ...builtIn.itemNames },
    robots: [...builtIn.robots],
    projects: [...builtIn.projects],
    recipes: [...builtIn.recipes],
    orderTemplates: [...builtIn.orderTemplates],
    provisionSeed: { ...builtIn.provisionSeed }
  };
  for (const draft of drafts) {
    if (draft.kind === "robot_template") upsertByStableId(body.robots, draft);
    else if (draft.kind === "project") upsertByStableId(body.projects, draft);
    else if (draft.kind === "recipe") upsertByStableId(body.recipes, draft);
    else if (draft.kind === "order") upsertByStableId(body.orderTemplates, draft);
  }
  return body;
}

// 整包校验：三条定义谓词逐条跑 + itemNames 覆盖 + 开局种子交叉校验 + 合并后
// stableId 唯一。与 catalog.service 的 fail-fast 同标准——保证发布出的整包一定
// 能经 createContentCatalog 装载，不会产出装不出来的 release。
function validatePackage(body: MergedPackageBody): string[] {
  const failures: string[] = [];
  for (const robot of body.robots) {
    const errors = validateRobotTemplate(robot);
    if (errors.length > 0) {
      failures.push(`robot template "${stableIdLabel(robot)}": ${errors.join("; ")}`);
    }
  }
  for (const project of body.projects) {
    const errors = validateProjectTemplate(project);
    if (errors.length > 0) {
      failures.push(`project "${stableIdLabel(project)}": ${errors.join("; ")}`);
    }
  }
  for (const recipe of body.recipes) {
    const errors = validateRecipeTemplate(recipe);
    if (errors.length > 0) {
      failures.push(`recipe "${stableIdLabel(recipe)}": ${errors.join("; ")}`);
    }
  }
  failures.push(
    ...validateItemNames(
      body.itemNames as Record<string, ContentItemInfo>,
      body.provisionSeed,
      body.projects
    )
  );
  const seedErrors = validateProvisionSeed(body.provisionSeed, body.robots, body.projects);
  if (seedErrors.length > 0) {
    failures.push(`provision seed: ${seedErrors.join("; ")}`);
  }
  const groups: Array<[string, unknown[]]> = [
    ["robot template", body.robots],
    ["project", body.projects],
    ["recipe", body.recipes]
  ];
  for (const [label, list] of groups) {
    const ids = list.map(stableIdLabel);
    if (new Set(ids).size !== ids.length) {
      failures.push(`duplicate ${label} stableIds in merged package`);
    }
  }
  return failures;
}

// 发布 payload：releaseId 与 provisionSeed.releaseId 对齐为本 workshop id——
// createContentCatalog 的 assertReleaseValid 要求两者一致，否则整包永远装不进去。
function toReleasePayload(releaseId: string, body: MergedPackageBody): ContentBaseRelease {
  return {
    releaseId,
    itemNames: body.itemNames as Record<string, ContentItemInfo>,
    robots: body.robots,
    projects: body.projects,
    recipes: body.recipes,
    orderTemplates: body.orderTemplates,
    provisionSeed: { ...body.provisionSeed, releaseId }
  };
}

export class ContentAdminService {
  constructor(
    private readonly repoFor: ContentAdminRepoProvider,
    private readonly clock: { now(): Date } = { now: () => new Date() }
  ) {}

  async listDrafts(
    tx: ContentAdminTx,
    principal: ContentAdminPrincipal
  ): Promise<ContentDraftDto[]> {
    assertAdmin(principal);
    const drafts = await this.repoFor(tx).listDrafts();
    return drafts.map(toDraftDto);
  }

  async createDraft(
    tx: ContentAdminTx,
    principal: ContentAdminPrincipal,
    input: CreateContentDraftInputDto
  ): Promise<ContentDraftDto> {
    assertAdmin(principal);
    assertCreateInput(input);
    const repo = this.repoFor(tx);
    const now = this.clock.now();
    const revision = (await repo.findMaxRevision(input.kind, input.stableId)) + 1;
    const record = await repo.insertDraft({
      kind: input.kind,
      stableId: input.stableId,
      revision,
      // payload 原样存：draft 期不校验不加工（合同：draft 可变，发布时整包校验）。
      payload: input.payload,
      createdAt: now,
      updatedAt: now
    });
    return toDraftDto(record);
  }

  async updateDraft(
    tx: ContentAdminTx,
    principal: ContentAdminPrincipal,
    input: UpdateContentDraftInputDto
  ): Promise<ContentDraftDto> {
    assertAdmin(principal);
    const repo = this.repoFor(tx);
    const draft = await repo.findDraftById(input.draftId);
    if (draft === null) {
      throw new BaseOperationError("VALIDATION_ERROR", `草稿不存在：${input.draftId}`);
    }
    if (draft.status !== "draft") {
      throw new BaseOperationError(
        "CONFLICT",
        `草稿已发布，不能修改：${draft.stableId}@${draft.revision}`
      );
    }
    const now = this.clock.now();
    const updated = await repo.updateDraftPayload(input.draftId, input.payload, now);
    if (!updated) {
      throw new BaseOperationError("CONFLICT", `草稿已发布，不能修改：${draft.stableId}@${draft.revision}`);
    }
    return {
      draftId: draft.id,
      kind: draft.kind,
      stableId: draft.stableId,
      revision: draft.revision,
      payload: input.payload,
      status: draft.status,
      updatedAt: now.toISOString()
    };
  }

  async deleteDraft(
    tx: ContentAdminTx,
    principal: ContentAdminPrincipal,
    draftId: string
  ): Promise<DeleteContentDraftResultDto> {
    assertAdmin(principal);
    const repo = this.repoFor(tx);
    const draft = await repo.findDraftById(draftId);
    if (draft === null) {
      throw new BaseOperationError("VALIDATION_ERROR", `草稿不存在：${draftId}`);
    }
    if (draft.status !== "draft") {
      throw new BaseOperationError(
        "CONFLICT",
        `草稿已发布，不能删除：${draft.stableId}@${draft.revision}`
      );
    }
    const deleted = await repo.deleteDraftById(draftId);
    if (!deleted) {
      throw new BaseOperationError("CONFLICT", `草稿已发布，不能删除：${draft.stableId}@${draft.revision}`);
    }
    return { draftId, deleted: true };
  }

  async listReleases(
    tx: ContentAdminTx,
    principal: ContentAdminPrincipal
  ): Promise<ContentReleaseSummaryDto[]> {
    assertAdmin(principal);
    const releases = await this.repoFor(tx).listReleases();
    return releases.map((release) => ({
      releaseId: release.releaseId,
      contentHash: release.contentHash,
      definitionCount: release.definitionCount,
      createdAt: release.createdAt.toISOString()
    }));
  }

  async publish(tx: ContentAdminTx, principal: ContentAdminPrincipal): Promise<PublishReleaseOutcome> {
    assertAdmin(principal);
    const repo = this.repoFor(tx);
    const drafts = (await repo.listDrafts()).filter((draft) => draft.status === "draft");
    const body = mergePackage(drafts);

    const failures = validatePackage(body);
    if (failures.length > 0) {
      throw new BaseOperationError(
        "CONTENT_INCOMPATIBLE",
        `内容整包校验失败（发布已回滚，零写入）：\n- ${failures.join("\n- ")}`
      );
    }

    // hash 覆盖不含 releaseId 的内容本体（releaseId 是 hash 的派生物，先 hash 后 id，
    // 避免自引用）。同内容 → 同 hash → 同 releaseId。
    const contentHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const releaseId = `${WORKSHOP_RELEASE_PREFIX}${contentHash.slice(0, RELEASE_ID_HASH_CHARS)}`;
    const definitionCount = body.robots.length + body.projects.length + body.recipes.length;
    const payload = toReleasePayload(releaseId, body);

    const inserted = await repo.insertRelease({
      releaseId,
      payload,
      contentHash,
      definitionCount,
      publishedBy: principal.accountId
    });

    let resultHash = contentHash;
    let resultCount = definitionCount;
    let duplicate = false;
    if (!inserted) {
      const existing = await repo.findReleaseByReleaseId(releaseId);
      if (existing === null) {
        throw new BaseOperationError(
          "INTERNAL_ERROR",
          `发布写入冲突且无法回读既有 release：${releaseId}`
        );
      }
      resultHash = existing.contentHash;
      resultCount = existing.definitionCount;
      duplicate = true;
    }

    // 校验与首插都通过后才消费草稿；publish 全程在调用方事务内，任何失败整体回滚。
    await repo.markDraftsPublished(this.clock.now());
    return { releaseId, definitionCount: resultCount, contentHash: resultHash, duplicate };
  }
}
