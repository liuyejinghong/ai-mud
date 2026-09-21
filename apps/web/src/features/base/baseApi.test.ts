import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseApiError,
  cancelProject,
  createProject,
  getSnapshot,
  heartbeat,
  login,
  playtestRegister,
  provision,
  setClock
} from "./baseApi.js";

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("baseApi", () => {
  it("getSnapshot 发起带 credentials 的 GET /base/snapshot 并解析快照", async () => {
    const snapshot = { baseId: "base-1", timeMode: "running" };
    fetchMock.mockResolvedValue(jsonResponse(200, snapshot));

    const result = await getSnapshot();

    expect(result).toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/base/snapshot");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBeUndefined();
  });

  it("createProject 携带 x-csrf-token 头与 JSON 请求体", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { projectId: "project-1", duplicate: false }));
    const input = {
      definitionRef: { kind: "project" as const, stableId: "install_solar_array", revision: 1 },
      siteId: "site_a",
      commandId: "cmd-1"
    };

    const result = await createProject(input, "csrf-1");

    expect(result).toEqual({ projectId: "project-1", duplicate: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/base/projects");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-csrf-token": "csrf-1"
    });
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("401 且无错误体时抛 UNAUTHENTICATED", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, null));

    const error: BaseApiError | null = await getSnapshot().then(
      () => null,
      (err: unknown) => err as BaseApiError
    );

    expect(error).toBeInstanceOf(BaseApiError);
    expect(error?.status).toBe(401);
    expect(error?.code).toBe("UNAUTHENTICATED");
  });

  it("解析 {error:{code,message}} 错误体", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: { code: "BASE_SCOPE_INVALID", message: "无权访问该基地" }
      })
    );

    const error: BaseApiError | null = await getSnapshot().then(
      () => null,
      (err: unknown) => err as BaseApiError
    );

    expect(error).toBeInstanceOf(BaseApiError);
    expect(error?.status).toBe(403);
    expect(error?.code).toBe("BASE_SCOPE_INVALID");
    expect(error?.message).toBe("无权访问该基地");
  });

  it("login 请求 /auth/login 并返回 csrfToken 载荷", async () => {
    const payload = {
      user: { id: "account-1", email: "p@e.test", role: "player", status: "active" },
      csrfToken: "csrf-2"
    };
    fetchMock.mockResolvedValue(jsonResponse(200, payload));

    const result = await login({ email: "p@e.test", password: "secret" });

    expect(result).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "p@e.test", password: "secret" });
  });

  it("playtestRegister 请求 /base/playtest-register 并返回注册结果", async () => {
    const payload = {
      user: { accountId: "account-9", email: "new@e.test" },
      baseId: "base-9",
      csrfToken: "csrf-9"
    };
    fetchMock.mockResolvedValue(jsonResponse(201, payload));

    const result = await playtestRegister({ email: "new@e.test", password: "secret" });

    expect(result).toEqual(payload);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/base/playtest-register");
  });

  it("provision、heartbeat、setClock、cancelProject 命中冻结 REST 面", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { baseId: "base-1", duplicate: false }));
    await provision("csrf-1");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/base/provision");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      "x-csrf-token": "csrf-1"
    });

    fetchMock.mockResolvedValue(
      jsonResponse(200, { leaseUntil: "2026-01-01T00:02:00.000Z", timeMode: "running" })
    );
    await heartbeat("csrf-1");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3000/base/heartbeat");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
      "x-csrf-token": "csrf-1"
    });

    fetchMock.mockResolvedValue(
      jsonResponse(200, { timeMode: "running", speed: 2, simTime: "2026-01-01T00:00:00.000Z" })
    );
    await setClock({ command: "set_speed", speed: 2 }, "csrf-1");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3000/base/clock");
    expect(JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual({
      command: "set_speed",
      speed: 2
    });

    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        cancelled: true,
        duplicate: false,
        completed: false,
        releasedInputs: [{ itemId: "anchor", quantity: 8 }]
      })
    );
    const cancelled = await cancelProject("project-1", "cmd-2", "csrf-1");
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "http://127.0.0.1:3000/base/projects/project-1/cancel"
    );
    expect(cancelled.releasedInputs).toEqual([{ itemId: "anchor", quantity: 8 }]);
  });
});
