import { eq } from "drizzle-orm";
import {
  DEFAULT_BASE_CONTENT_RELEASE,
  TUTORIAL_BASE_CONTENT_RELEASE,
  type ContentBaseRelease
} from "@ai-mud/content";
import type { Db } from "../../db/client.js";
import { contentReleases } from "../../db/schema.js";
import { createContentCatalog, type ContentCatalogPort } from "./catalog.service.js";

// 内置 release 读取冻结定义；其它 release 必须有对应发布行，未知 ID 显式报错。
export async function loadReleaseCatalog(
  db: Pick<Db, "select">,
  releaseId: string
): Promise<ContentCatalogPort> {
  if (releaseId === DEFAULT_BASE_CONTENT_RELEASE.releaseId) {
    return createContentCatalog(DEFAULT_BASE_CONTENT_RELEASE);
  }
  if (releaseId === TUTORIAL_BASE_CONTENT_RELEASE.releaseId) {
    return createContentCatalog(TUTORIAL_BASE_CONTENT_RELEASE);
  }
  const rows = await db
    .select({ payload: contentReleases.payload })
    .from(contentReleases)
    .where(eq(contentReleases.releaseId, releaseId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Unknown content release: ${releaseId}`);
  }
  return createContentCatalog(row.payload as ContentBaseRelease);
}
