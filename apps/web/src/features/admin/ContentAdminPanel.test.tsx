import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentAdminPanel } from "./ContentAdminPanel";

const CSRF_TOKEN = "csrf-token";
const API_ROOT = "http://127.0.0.1:3000";

const draftFixture = {
  draftId: "draft-1",
  kind: "recipe",
  stableId: "manufacture-yd-h1",
  revision: 2,
  payload: { name: "制造 YD-H1", workPerUnit: 30 },
  status: "draft",
  updatedAt: "2026-09-19T08:00:00.000Z"
};

const releaseFixture = {
  releaseId: "rel-1",
  contentHash: "sha256:abc123",
  definitionCount: 5,
  createdAt: "2026-09-19T07:00:00.000Z"
};

interface HttpFailureStub {
  __httpError: true;
  status: number;
  body: unknown;
}

function fail(status: number, body: unknown): HttpFailureStub {
  return { __httpError: true, status, body };
}

function isHttpFailure(value: unknown): value is HttpFailureStub {
  return typeof value === "object" && value !== null && "__httpError" in value;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body)
  };
}

type RouteTable = Record<string, (init?: RequestInit) => unknown>;

function stubContentFetch(routes: RouteTable = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).replace(API_ROOT, "")}`;
    const respond =
      routes[key] ??
      (key === "GET /admin/content/drafts"
        ? () => ({ drafts: [draftFixture] })
        : key === "GET /admin/content/releases"
          ? () => ({ releases: [releaseFixture] })
          : undefined);
    if (!respond) {
      throw new Error(`unexpected request: ${key}`);
    }
    const result = await respond(init);
    if (isHttpFailure(result)) {
      return jsonResponse(result.body, false, result.status);
    }
    return jsonResponse(result);
  });
}

describe("ContentAdminPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the draft list and the release history", async () => {
    vi.stubGlobal("fetch", stubContentFetch());

    render(<ContentAdminPanel csrfToken={CSRF_TOKEN} />);

    expect(await screen.findByText("manufacture-yd-h1")).toBeTruthy();
    expect(screen.getByText("r2")).toBeTruthy();
    expect(screen.getByText("rel-1")).toBeTruthy();
    expect(screen.getByText("sha256:abc123")).toBeTruthy();
  });

  it("posts the new draft with method, headers and body", async () => {
    const fetchMock = stubContentFetch({
      "POST /admin/content/drafts": () => draftFixture
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ContentAdminPanel csrfToken={CSRF_TOKEN} />);
    await screen.findByText("manufacture-yd-h1");

    fireEvent.change(screen.getByLabelText("类型"), { target: { value: "recipe" } });
    fireEvent.change(screen.getByLabelText("稳定 ID"), {
      target: { value: "manufacture-yd-s1" }
    });
    fireEvent.change(screen.getByLabelText("Payload（JSON）"), {
      target: { value: '{"name":"制造 YD-S1"}' }
    });

    const saveButton = screen.getByRole("button", { name: "新建草稿" });
    expect(saveButton).toHaveProperty("disabled", false);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_ROOT}/admin/content/drafts`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": CSRF_TOKEN
          },
          body: JSON.stringify({
            kind: "recipe",
            stableId: "manufacture-yd-s1",
            payload: { name: "制造 YD-S1" }
          })
        })
      );
    });
    expect(await screen.findByText(/已创建/)).toBeTruthy();
  });

  it("disables the submit button while the payload is not valid JSON", async () => {
    vi.stubGlobal("fetch", stubContentFetch());

    render(<ContentAdminPanel csrfToken={CSRF_TOKEN} />);
    await screen.findByText("manufacture-yd-h1");

    const saveButton = screen.getByRole("button", { name: "新建草稿" });
    fireEvent.change(screen.getByLabelText("稳定 ID"), { target: { value: "bad-payload" } });

    expect(saveButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Payload（JSON）"), {
      target: { value: "{ not json" }
    });
    expect(saveButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Payload（JSON）"), {
      target: { value: '{"name":"合法"}' }
    });
    expect(saveButton).toHaveProperty("disabled", false);
  });

  it("publishes the whole pack after confirmation and shows releaseId and contentHash", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubContentFetch({
      "POST /admin/content/publish": () => ({
        releaseId: "rel-9",
        definitionCount: 7,
        contentHash: "sha256:deadbeef"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ContentAdminPanel csrfToken={CSRF_TOKEN} />);
    await screen.findByText("manufacture-yd-h1");

    fireEvent.click(screen.getByRole("button", { name: "发布整包" }));

    expect(await screen.findByText(/最近发布：rel-9/)).toBeTruthy();
    expect(screen.getByText(/内容哈希\s*sha256:deadbeef/)).toBeTruthy();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("不可变"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_ROOT}/admin/content/publish`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": CSRF_TOKEN
          },
          body: JSON.stringify({})
        })
      );
    });
  });

  it("activates a release to a base with the contract body", async () => {
    const fetchMock = stubContentFetch({
      "POST /admin/content/activate": () => ({ baseId: "base-9", releaseId: "rel-1" })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ContentAdminPanel csrfToken={CSRF_TOKEN} />);
    await screen.findByText("rel-1");

    fireEvent.change(screen.getByLabelText("发布版本"), { target: { value: "rel-1" } });
    fireEvent.change(screen.getByLabelText("基地 ID"), { target: { value: " base-9 " } });

    const activateButton = screen.getByRole("button", { name: "激活到基地" });
    expect(activateButton).toHaveProperty("disabled", false);
    fireEvent.click(activateButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_ROOT}/admin/content/activate`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": CSRF_TOKEN
          },
          body: JSON.stringify({ releaseId: "rel-1", baseId: "base-9" })
        })
      );
    });
    expect(await screen.findByText(/已将发布 rel-1 激活到基地 base-9/)).toBeTruthy();
  });

  it("shows the server error in a role=alert element", async () => {
    vi.stubGlobal(
      "fetch",
      stubContentFetch({
        "GET /admin/content/drafts": () =>
          fail(403, { error: { code: "FORBIDDEN", message: "需要管理员角色。" } })
      })
    );

    render(<ContentAdminPanel csrfToken={CSRF_TOKEN} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("需要管理员角色。");
  });

  it("refills the payload for editing and puts the draft update", async () => {
    const fetchMock = stubContentFetch({
      "PUT /admin/content/drafts/draft-1": () => ({ ...draftFixture, revision: 3 })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ContentAdminPanel csrfToken={CSRF_TOKEN} />);
    await screen.findByText("manufacture-yd-h1");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    const payloadField = screen.getByLabelText("Payload（JSON）") as HTMLTextAreaElement;
    expect(payloadField.value).toContain("workPerUnit");

    fireEvent.change(payloadField, { target: { value: '{"name":"制造 YD-H1 改"}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_ROOT}/admin/content/drafts/draft-1`,
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": CSRF_TOKEN
          },
          body: JSON.stringify({
            draftId: "draft-1",
            payload: { name: "制造 YD-H1 改" }
          })
        })
      );
    });
    expect(await screen.findByText(/已保存/)).toBeTruthy();
  });

  it("deletes a draft with the DELETE method", async () => {
    const fetchMock = stubContentFetch({
      "DELETE /admin/content/drafts/draft-1": () => ({ draftId: "draft-1", deleted: true })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ContentAdminPanel csrfToken={CSRF_TOKEN} />);
    await screen.findByText("manufacture-yd-h1");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_ROOT}/admin/content/drafts/draft-1`,
        expect.objectContaining({
          method: "DELETE",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": CSRF_TOKEN
          }
        })
      );
    });
    expect(await screen.findByText(/已删除/)).toBeTruthy();
  });
});
