import { useCallback, useEffect, useMemo, useState } from "react";
import { CONTENT_DEFINITION_KINDS } from "@ai-mud/shared";
import type {
  ActivateContentReleaseInputDto,
  ContentDefinitionKind,
  ContentDraftDto,
  ContentReleaseSummaryDto,
  CreateContentDraftInputDto,
  PublishContentReleaseResultDto,
  UpdateContentDraftInputDto
} from "@ai-mud/shared";
import "./ActivationCodeAdmin.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:3000";

const KIND_LABELS: Record<ContentDefinitionKind, string> = {
  robot_template: "机器人模板",
  project: "项目",
  recipe: "配方"
};

const DRAFT_STATUS_LABELS: Record<ContentDraftDto["status"], string> = {
  draft: "草稿",
  published: "已发布"
};

export class ContentAdminError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

interface DraftListResponse {
  drafts: ContentDraftDto[];
}

interface ReleaseListResponse {
  releases: ContentReleaseSummaryDto[];
}

function isErrorResponse(value: unknown): value is { error: { code: string; message: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "object" &&
    (value as { error: { code?: unknown } }).error !== null &&
    typeof (value as { error: { code?: unknown } }).error.code === "string" &&
    typeof (value as { error: { message?: unknown } }).error.message === "string"
  );
}

async function requestContentAdmin<T>(
  path: string,
  csrfToken: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-ai-mud-csrf": csrfToken,
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    let code = response.status === 401 ? "UNAUTHENTICATED" : "REQUEST_FAILED";
    let message =
      response.status === 401
        ? "登录已失效，请重新登录。"
        : response.status === 403
          ? "需要管理员权限。"
          : `请求失败：${response.status}`;
    try {
      const body: unknown = JSON.parse(await response.text());
      if (isErrorResponse(body)) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // 服务器未返回 JSON 时保留按状态码推导的兜底文案。
    }
    throw new ContentAdminError(response.status, code, message);
  }

  const raw = await response.text();
  if (raw.length === 0) {
    // DELETE 等请求可能没有响应体。
    return undefined as unknown as T;
  }
  return JSON.parse(raw) as T;
}

function listContentDrafts(csrfToken: string) {
  return requestContentAdmin<DraftListResponse>("/admin/content/drafts", csrfToken);
}

function createContentDraft(input: CreateContentDraftInputDto, csrfToken: string) {
  return requestContentAdmin<ContentDraftDto>("/admin/content/drafts", csrfToken, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

function updateContentDraft(input: UpdateContentDraftInputDto, csrfToken: string) {
  return requestContentAdmin<ContentDraftDto>(
    `/admin/content/drafts/${encodeURIComponent(input.draftId)}`,
    csrfToken,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
}

function deleteContentDraft(draftId: string, csrfToken: string) {
  return requestContentAdmin<unknown>(
    `/admin/content/drafts/${encodeURIComponent(draftId)}`,
    csrfToken,
    {
      method: "DELETE"
    }
  );
}

function publishContentRelease(csrfToken: string) {
  return requestContentAdmin<PublishContentReleaseResultDto>("/admin/content/publish", csrfToken, {
    method: "POST",
    body: JSON.stringify({})
  });
}

function listContentReleases(csrfToken: string) {
  return requestContentAdmin<ReleaseListResponse>("/admin/content/releases", csrfToken);
}

function activateContentRelease(input: ActivateContentReleaseInputDto, csrfToken: string) {
  return requestContentAdmin<unknown>("/admin/content/activate", csrfToken, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function ContentAdminPanel({ csrfToken }: { csrfToken: string }) {
  const [drafts, setDrafts] = useState<ContentDraftDto[]>([]);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [releases, setReleases] = useState<ContentReleaseSummaryDto[]>([]);
  const [releasesError, setReleasesError] = useState<string | null>(null);

  const [kind, setKind] = useState<ContentDefinitionKind>("robot_template");
  const [stableId, setStableId] = useState("");
  const [payloadText, setPayloadText] = useState("");
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastPublish, setLastPublish] = useState<PublishContentReleaseResultDto | null>(null);

  const [activateReleaseId, setActivateReleaseId] = useState("");
  const [baseId, setBaseId] = useState("");

  const payloadParseError = useMemo(() => {
    if (payloadText.trim() === "") return "Payload 不能为空。";
    try {
      const parsed: unknown = JSON.parse(payloadText);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "Payload 必须是 JSON 对象。";
      }
      return null;
    } catch (error) {
      return `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }, [payloadText]);

  const loadDrafts = useCallback(async () => {
    try {
      const result = await listContentDrafts(csrfToken);
      setDrafts(result.drafts);
      setDraftsError(null);
    } catch (error) {
      setDraftsError(error instanceof Error ? error.message : "加载草稿列表失败。");
    }
  }, [csrfToken]);

  const loadReleases = useCallback(async () => {
    try {
      const result = await listContentReleases(csrfToken);
      setReleases(result.releases);
      setReleasesError(null);
      setActivateReleaseId((current) => current || result.releases[0]?.releaseId || "");
    } catch (error) {
      setReleasesError(error instanceof Error ? error.message : "加载发布历史失败。");
    }
  }, [csrfToken]);

  useEffect(() => {
    void loadDrafts();
    void loadReleases();
  }, [loadDrafts, loadReleases]);

  function resetForm() {
    setEditingDraftId(null);
    setKind("robot_template");
    setStableId("");
    setPayloadText("");
  }

  function handleEditDraft(draft: ContentDraftDto) {
    setActionError(null);
    setStatusMessage(null);
    setEditingDraftId(draft.draftId);
    setKind(draft.kind);
    setStableId(draft.stableId);
    setPayloadText(JSON.stringify(draft.payload, null, 2));
  }

  async function handleDeleteDraft(draft: ContentDraftDto) {
    setSubmitting(true);
    setActionError(null);
    try {
      await deleteContentDraft(draft.draftId, csrfToken);
      setStatusMessage(`草稿 ${draft.stableId} 已删除。`);
      if (editingDraftId === draft.draftId) resetForm();
      await loadDrafts();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "删除草稿失败。");
    } finally {
      setSubmitting(false);
    }
  }

  const canSaveDraft =
    payloadParseError === null &&
    (editingDraftId !== null || stableId.trim() !== "") &&
    !submitting;

  async function handleSaveDraft() {
    if (!canSaveDraft) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText) as Record<string, unknown>;
    } catch {
      return; // 提交前已由 canSaveDraft 拦截，理论上不可达。
    }

    setSubmitting(true);
    setActionError(null);
    try {
      if (editingDraftId !== null) {
        await updateContentDraft({ draftId: editingDraftId, payload }, csrfToken);
        setStatusMessage(`草稿 ${stableId.trim()} 已保存。`);
      } else {
        await createContentDraft({ kind, stableId: stableId.trim(), payload }, csrfToken);
        setStatusMessage(`草稿 ${stableId.trim()} 已创建。`);
      }
      resetForm();
      await loadDrafts();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "保存草稿失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish() {
    const confirmed = window.confirm("发布后修订不可变，确认发布整包内容？");
    if (!confirmed) return;

    setSubmitting(true);
    setActionError(null);
    try {
      const result = await publishContentRelease(csrfToken);
      setLastPublish(result);
      setStatusMessage(`整包发布成功：${result.releaseId}`);
      await Promise.all([loadDrafts(), loadReleases()]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "发布整包失败。");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedActivateReleaseId = activateReleaseId || releases[0]?.releaseId || "";

  async function handleActivate() {
    const trimmedBaseId = baseId.trim();
    if (selectedActivateReleaseId === "" || trimmedBaseId === "") return;

    setSubmitting(true);
    setActionError(null);
    try {
      await activateContentRelease(
        { releaseId: selectedActivateReleaseId, baseId: trimmedBaseId },
        csrfToken
      );
      setStatusMessage(`已将发布 ${selectedActivateReleaseId} 激活到基地 ${trimmedBaseId}。`);
      setBaseId("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "激活失败。");
    } finally {
      setSubmitting(false);
    }
  }

  const loadError =
    draftsError !== null || releasesError !== null
      ? `内容目录加载失败：${[draftsError, releasesError].filter(Boolean).join("；")}`
      : null;

  return (
    <section className="admin-panel" aria-labelledby="content-admin-title">
      <div className="admin-panel-header">
        <h2 id="content-admin-title">内容工坊</h2>
        <span>Content Catalog</span>
      </div>

      <div className="admin-panel-body">
        {loadError !== null ? <p role="alert">{loadError}</p> : null}
        {actionError !== null ? <p role="alert">{actionError}</p> : null}
        {statusMessage !== null ? (
          <p role="status" aria-live="polite" className="admin-status">
            {statusMessage}
          </p>
        ) : null}

        <h3>草稿</h3>
        <button type="button" onClick={() => void loadDrafts()}>
          刷新草稿
        </button>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>稳定 ID</th>
              <th>修订</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {drafts.length === 0 ? (
              <tr>
                <td colSpan={6}>暂无草稿</td>
              </tr>
            ) : (
              drafts.map((draft) => (
                <tr key={draft.draftId}>
                  <td>{KIND_LABELS[draft.kind]}</td>
                  <td>{draft.stableId}</td>
                  <td>r{draft.revision}</td>
                  <td>{DRAFT_STATUS_LABELS[draft.status]}</td>
                  <td>{formatTimestamp(draft.updatedAt)}</td>
                  <td>
                    <button type="button" onClick={() => handleEditDraft(draft)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleDeleteDraft(draft)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h3>{editingDraftId !== null ? "编辑草稿" : "新建草稿"}</h3>
        <div className="admin-field">
          <span>类型</span>
          <select
            aria-label="类型"
            value={kind}
            disabled={editingDraftId !== null}
            onChange={(event) => setKind(event.target.value as ContentDefinitionKind)}
          >
            {CONTENT_DEFINITION_KINDS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <label className="admin-field" htmlFor="content-admin-stable-id">
          稳定 ID
          <input
            id="content-admin-stable-id"
            value={stableId}
            disabled={editingDraftId !== null}
            placeholder="例如 manufacture-yd-h1"
            onChange={(event) => setStableId(event.target.value)}
          />
        </label>
        <label className="admin-field" htmlFor="content-admin-payload">
          Payload（JSON）
          <textarea
            id="content-admin-payload"
            rows={8}
            value={payloadText}
            placeholder={'{ "name": "示例定义" }'}
            onChange={(event) => setPayloadText(event.target.value)}
          />
        </label>
        {payloadParseError !== null ? <p className="admin-status">{payloadParseError}</p> : null}
        <button type="button" disabled={!canSaveDraft} onClick={() => void handleSaveDraft()}>
          {editingDraftId !== null ? "保存草稿" : "新建草稿"}
        </button>
        {editingDraftId !== null ? (
          <button type="button" onClick={resetForm}>
            取消编辑
          </button>
        ) : null}

        <h3>发布整包</h3>
        <button type="button" disabled={submitting} onClick={() => void handlePublish()}>
          发布整包
        </button>
        {lastPublish !== null ? (
          <p>
            最近发布：{lastPublish.releaseId}（{lastPublish.definitionCount} 条定义，内容哈希{" "}
            {lastPublish.contentHash}）
          </p>
        ) : null}

        <h3>发布历史</h3>
        <table>
          <thead>
            <tr>
              <th>releaseId</th>
              <th>定义数</th>
              <th>内容哈希</th>
              <th>发布时间</th>
            </tr>
          </thead>
          <tbody>
            {releases.length === 0 ? (
              <tr>
                <td colSpan={4}>暂无发布</td>
              </tr>
            ) : (
              releases.map((release) => (
                <tr key={release.releaseId}>
                  <td>{release.releaseId}</td>
                  <td>{release.definitionCount}</td>
                  <td>{release.contentHash}</td>
                  <td>{formatTimestamp(release.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h3>激活到基地</h3>
        <div className="admin-field">
          <span>发布版本</span>
          <select
            aria-label="发布版本"
            value={selectedActivateReleaseId}
            onChange={(event) => setActivateReleaseId(event.target.value)}
          >
            {releases.length === 0 ? (
              <option value="">（暂无可选发布）</option>
            ) : (
              releases.map((release) => (
                <option key={release.releaseId} value={release.releaseId}>
                  {release.releaseId}（{release.definitionCount} 条定义）
                </option>
              ))
            )}
          </select>
        </div>
        <label className="admin-field" htmlFor="content-admin-base-id">
          基地 ID
          <input
            id="content-admin-base-id"
            value={baseId}
            placeholder="例如 base-1"
            onChange={(event) => setBaseId(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={submitting || selectedActivateReleaseId === "" || baseId.trim() === ""}
          onClick={() => void handleActivate()}
        >
          激活到基地
        </button>
      </div>
    </section>
  );
}
