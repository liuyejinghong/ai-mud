import type {
  ContentDraftDto,
  ContentReleaseSummaryDto,
  CreateContentDraftInputDto,
  UpdateContentDraftInputDto
} from "@ai-mud/shared";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { bases } from "../../db/schema.js";
import { DrizzleAuditWriter } from "../../modules/audit/audit.repository.js";
import { ContentAdminRepository } from "../../modules/content-catalog/content-admin.repository.js";
import {
  BaseOperationError,
  ContentAdminService,
  type ContentAdminPrincipal,
  type DeleteContentDraftResultDto,
  type PublishReleaseOutcome
} from "../../modules/content-catalog/content-admin.service.js";

// M13-A 内容工坊应用用例：只负责事务边界 + 管理员 principal 透传；业务语义在
// content-catalog/content-admin.service（m13-p-contract.md §6：transport 只 import
// application）。BaseOperationError 在此再导出给 B 线 admin/content-admin.routes.ts，
// 路由按 { code, message } 形状映射 400/403，不直接 import 模块内部。

export { BaseOperationError };
export type { ContentAdminPrincipal, DeleteContentDraftResultDto, PublishReleaseOutcome };

// ports 风格冻结面：composition 按结构绑定本接口（漂移由类型断言锁定）。
export interface ActivateContentReleaseInput {
  releaseId: string;
  baseId: string;
}

export interface ContentAdminUseCasesPort {
  activate(principal: ContentAdminPrincipal, input: ActivateContentReleaseInput): Promise<void>;
  listDrafts(principal: ContentAdminPrincipal): Promise<ContentDraftDto[]>;
  createDraft(
    principal: ContentAdminPrincipal,
    input: CreateContentDraftInputDto
  ): Promise<ContentDraftDto>;
  updateDraft(
    principal: ContentAdminPrincipal,
    input: UpdateContentDraftInputDto
  ): Promise<ContentDraftDto>;
  deleteDraft(principal: ContentAdminPrincipal, draftId: string): Promise<DeleteContentDraftResultDto>;
  publish(principal: ContentAdminPrincipal): Promise<PublishReleaseOutcome>;
  listReleases(principal: ContentAdminPrincipal): Promise<ContentReleaseSummaryDto[]>;
}

export class ContentAdminUseCases implements ContentAdminUseCasesPort {
  constructor(
    private readonly db: Db,
    private readonly service: ContentAdminService
  ) {}

  // 激活：把基地的内容指针切到已发布 release（P 合同 §2：写者 content-catalog 经用例；
  // M15+ 可演进为 world 公开接口）。
  async activate(
    principal: ContentAdminPrincipal,
    input: ActivateContentReleaseInput
  ): Promise<void> {
    if (principal.role !== "admin" && principal.role !== "super_admin") {
      throw new BaseOperationError("FORBIDDEN", "需要管理员权限。");
    }
    await this.db.transaction(async (tx) => {
      const releases = await this.service.listReleases(tx, principal);
      const target = releases.find((release) => release.releaseId === input.releaseId);
      if (!target) {
        throw new BaseOperationError("VALIDATION_ERROR", "发布版本不存在。");
      }
      await tx
        .update(bases)
        .set({ contentRelease: input.releaseId, baseRevision: sql`base_revision + 1` })
        .where(eq(bases.id, input.baseId));
      await new DrizzleAuditWriter(tx).write({
        actorAccountId: principal.accountId,
        action: "content_release.activate",
        targetType: "base",
        targetId: input.baseId,
        reason: "content_activation",
        metadata: { releaseId: input.releaseId }
      });
    });
  }

  listDrafts(principal: ContentAdminPrincipal): Promise<ContentDraftDto[]> {
    return this.db.transaction((tx) => this.service.listDrafts(tx, principal));
  }

  createDraft(
    principal: ContentAdminPrincipal,
    input: CreateContentDraftInputDto
  ): Promise<ContentDraftDto> {
    return this.db.transaction((tx) => this.service.createDraft(tx, principal, input));
  }

  updateDraft(
    principal: ContentAdminPrincipal,
    input: UpdateContentDraftInputDto
  ): Promise<ContentDraftDto> {
    return this.db.transaction((tx) => this.service.updateDraft(tx, principal, input));
  }

  deleteDraft(principal: ContentAdminPrincipal, draftId: string): Promise<DeleteContentDraftResultDto> {
    return this.db.transaction((tx) => this.service.deleteDraft(tx, principal, draftId));
  }

  publish(principal: ContentAdminPrincipal): Promise<PublishReleaseOutcome> {
    return this.db.transaction((tx) => this.service.publish(tx, principal));
  }

  listReleases(principal: ContentAdminPrincipal): Promise<ContentReleaseSummaryDto[]> {
    return this.db.transaction((tx) => this.service.listReleases(tx, principal));
  }
}

// 组合根默认装配：ContentAdminService 经 (tx) => repo 工厂换绑事务。
export function createContentAdminUseCases(db: Db): ContentAdminUseCasesPort {
  return new ContentAdminUseCases(
    db,
    new ContentAdminService((tx) => new ContentAdminRepository(tx))
  );
}
