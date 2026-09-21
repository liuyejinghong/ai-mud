import { eq } from "drizzle-orm";
import { DEFAULT_BASE_CONTENT_RELEASE, type ContentBaseRelease } from "@ai-mud/content";
import type { Db } from "../../db/client.js";
import { contentReleases } from "../../db/schema.js";
import { createContentCatalog, type ContentCatalogPort } from "./catalog.service.js";

// M13-A 目录装载（m13-p-contract.md §3 CatalogPort 扩展的解析后半段）：
// base.content_release 指向的 content_releases 行 → 整包 payload → createContentCatalog。
// 查不到该 release_id（含基地仍指向内置 id "yudian-base-0" 的情况）→ 显式回退内置
// release——这是合同 §3 声明的显式 fallback，不是静默升位。payload 若校验失败，
// createContentCatalog 会 fail-fast 抛错（不带病提供目录）。
export async function loadReleaseCatalog(
  db: Pick<Db, "select">,
  releaseId: string
): Promise<ContentCatalogPort> {
  const rows = await db
    .select({ payload: contentReleases.payload })
    .from(contentReleases)
    .where(eq(contentReleases.releaseId, releaseId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    return createContentCatalog(DEFAULT_BASE_CONTENT_RELEASE);
  }
  return createContentCatalog(row.payload as ContentBaseRelease);
}
