import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import { BaseApp } from "./BaseApp.js";
import { BaseApiError, getSnapshot, heartbeat, login, playtestRegister, provision } from "./baseApi.js";

vi.mock("./baseApi.js", () => ({
  BaseApiError: class BaseApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
  getSnapshot: vi.fn(),
  provision: vi.fn(),
  playtestRegister: vi.fn(),
  heartbeat: vi.fn(),
  setClock: vi.fn(),
  createProject: vi.fn(),
  cancelProject: vi.fn(),
  login: vi.fn()
}));

vi.mock("./BaseShell.js", () => ({
  BaseShell: ({ snapshot }: { snapshot: { baseId: string } }) => (
    <div data-testid="base-shell">基地 {snapshot.baseId}</div>
  )
}));

function buildSnapshot(overrides: Partial<BaseSnapshotDto> = {}): BaseSnapshotDto {
  return {
    name: "先遣前哨",
    baseId: "base-1",
    epoch: 1,
    baseRevision: 1,
    simTime: "2126-01-01T08:00:00.000Z",
    timeMode: "running",
    speed: 1,
    activeContentRelease: "default-release",
    power: {
      generationWPeak: 13500,
      availableW: 12500,
      storageWh: 100000,
      storageCapacityWh: 200000,
      loadW: 1000
    },
    resources: [{ itemId: "spare_parts", name: "备件", quantity: 30, description: "测试物资说明" }],
    sites: [{ siteId: "site-a", name: "测试站点", siteKey: "array", state: "built", note: null, description: null, attributes: [] }],
    devices: [],
    projects: [],
    buildableProjects: [],
    manufacturingJobs: [],
    availableRecipes: [],
    cooperationRequests: [],
    credits: 500,
    orders: [],
    purchases: [],
    weather: {
      current: "clear",
      lightFactor: 1.0,
      dustLevel: 30,
      nextChangeAt: "2126-01-01T20:00:00.000Z",
      nextWeather: "warning"
    },
  controlLease: { heldByThisSession: true, leaseUntil: "2126-01-01T08:02:00.000Z" },
    ...overrides
  };
}

const unauthorized = () => new BaseApiError(401, "UNAUTHENTICATED", "登录已失效，请重新登录。");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BaseApp", () => {
  it("挂载后拉取快照并进入基地主界面", async () => {
    vi.mocked(getSnapshot).mockResolvedValue(buildSnapshot());

    render(<BaseApp />);

    expect(await screen.findByTestId("base-shell")).toBeTruthy();
    expect(getSnapshot).toHaveBeenCalledOnce();
    expect(screen.queryByText("领取试玩基地")).toBeNull();
  });

  it("未登录（401）时显示登录与试玩注册表单", async () => {
    vi.mocked(getSnapshot).mockRejectedValue(unauthorized());

    render(<BaseApp />);

    expect(await screen.findByRole("button", { name: "领取试玩基地" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "账号登录" })).toBeTruthy();
  });

  it("引导关闭标记按基地隔离：同基地不再弹，换基地仍弹（UX-02）", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value)
    });
    vi.mocked(getSnapshot).mockResolvedValue(buildSnapshot());

    const first = render(<BaseApp />);
    fireEvent.click(await screen.findByRole("button", { name: "开始指挥" }));
    expect(screen.queryByRole("dialog", { name: "新手引导" })).toBeNull();
    first.unmount();

    const second = render(<BaseApp />);
    await screen.findByTestId("base-shell");
    expect(screen.queryByRole("dialog", { name: "新手引导" })).toBeNull();
    second.unmount();

    vi.mocked(getSnapshot).mockResolvedValue({ ...buildSnapshot(), baseId: "base-other" });
    render(<BaseApp />);
    await screen.findByTestId("base-shell");
    expect(screen.getByRole("dialog", { name: "新手引导" })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("快照加载失败（非 401）时显示错误与重试入口，不静默卡在连接中（SYNC-01）", async () => {
    vi.mocked(getSnapshot)
      .mockRejectedValueOnce(new BaseApiError(503, "UNAVAILABLE", "服务暂不可用"))
      .mockResolvedValue(buildSnapshot());

    render(<BaseApp />);

    expect(await screen.findByRole("heading", { name: "基地连接失败" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("服务暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
    expect(await screen.findByTestId("base-shell")).toBeTruthy();
  });

  it("快照轮询失败但已有画面时显示陈旧提示条，不中断使用（SYNC-01）", async () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    vi.mocked(getSnapshot)
      .mockResolvedValueOnce(buildSnapshot())
      .mockRejectedValueOnce(new BaseApiError(503, "UNAVAILABLE", "服务暂不可用"))
      .mockResolvedValue(buildSnapshot());

    render(<BaseApp />);
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByRole("alert").textContent).toContain("基地状态刷新失败");
    expect(screen.getByTestId("base-shell")).toBeTruthy();
  });

  it("试玩注册成功后自动 provision 并进入主界面", async () => {
    vi.mocked(getSnapshot)
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValue(buildSnapshot());
    vi.mocked(playtestRegister).mockResolvedValue({
      user: { accountId: "account-9", email: "p@e.test" },
      baseId: "base-1",
      csrfToken: "csrf-1"
    });
    vi.mocked(provision).mockResolvedValue({ baseId: "base-1", duplicate: false });

    render(<BaseApp />);

    fireEvent.change(await screen.findByLabelText("邮箱"), { target: { value: "p@e.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "领取试玩基地" }));

    expect(await screen.findByTestId("base-shell")).toBeTruthy();
    expect(playtestRegister).toHaveBeenCalledOnce();
    expect(playtestRegister).toHaveBeenCalledWith({ email: "p@e.test", password: "secret" });
    expect(provision).toHaveBeenCalledOnce();
  });

  it("已有账号登录成功后同样自动 provision", async () => {
    vi.mocked(getSnapshot)
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValue(buildSnapshot());
    vi.mocked(login).mockResolvedValue({
      user: { id: "account-1", email: "p@e.test", role: "player", status: "active" },
      csrfToken: "csrf-2"
    });
    vi.mocked(provision).mockResolvedValue({ baseId: "base-1", duplicate: true });

    render(<BaseApp />);

    fireEvent.click(await screen.findByRole("tab", { name: "账号登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "p@e.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并进入基地" }));

    expect(await screen.findByTestId("base-shell")).toBeTruthy();
    expect(login).toHaveBeenCalledWith({ email: "p@e.test", password: "secret" });
    expect(provision).toHaveBeenCalledOnce();
  });

  it("每 5 秒轮询快照，且仅在页面可见时拉取", async () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    vi.mocked(getSnapshot).mockResolvedValue(buildSnapshot());

    render(<BaseApp />);
    await act(async () => {});
    expect(getSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getSnapshot).toHaveBeenCalledTimes(2);

    visibility.mockReturnValue("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(getSnapshot).toHaveBeenCalledTimes(2);

    visibility.mockReturnValue("visible");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getSnapshot).toHaveBeenCalledTimes(3);
  });

  it("登录前不发送心跳，登录后每 30 秒用 csrfToken 心跳续租", async () => {
    vi.useFakeTimers();
    vi.mocked(getSnapshot).mockRejectedValue(unauthorized());

    render(<BaseApp />);
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(heartbeat).not.toHaveBeenCalled();

    // 切换为已登录链路：登录 → provision → 快照成功。
    vi.mocked(getSnapshot).mockResolvedValue(buildSnapshot());
    vi.mocked(heartbeat).mockResolvedValue({
      leaseUntil: "2126-01-01T08:02:00.000Z",
      timeMode: "running"
    });
    vi.mocked(login).mockResolvedValue({
      user: { id: "account-1", email: "p@e.test", role: "player", status: "active" },
      csrfToken: "csrf-hb"
    });
    vi.mocked(provision).mockResolvedValue({ baseId: "base-1", duplicate: false });

    fireEvent.click(screen.getByRole("tab", { name: "账号登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "p@e.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "登录并进入基地" }));
    });
    expect(screen.getByTestId("base-shell")).toBeTruthy();
    expect(heartbeat).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledWith("csrf-hb");
  });
});

describe("BaseApp > 完工横幅", () => {
  it("项目从进行中变为已完成时显示完工横幅，可关闭", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const running = buildSnapshot({
      projects: [
        {
          projectId: "p-1",
          definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
          name: "安装运抵的太阳能设施",
          status: "active",
          siteId: "site-a",
          steps: []
        }
      ]
    });
    const done = buildSnapshot({
      projects: [
        {
          projectId: "p-1",
          definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
          name: "安装运抵的太阳能设施",
          status: "completed",
          siteId: "site-a",
          steps: []
        }
      ]
    });
    vi.mocked(getSnapshot).mockResolvedValueOnce(running).mockResolvedValue(done);

    render(<BaseApp />);
    await act(async () => {});
    expect(screen.queryByText(/已完工/)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText(/安装运抵的太阳能设施已完工/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭完工提示" }));
    expect(screen.queryByText(/已完工/)).toBeNull();
    visibility.mockRestore();
  });
});
