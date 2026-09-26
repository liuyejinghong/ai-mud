import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import { BaseApp } from "./BaseApp.js";
import { BaseApiError, createPurchase, decideCooperation, getSnapshot, heartbeat, login, playtestRegister, provision } from "./baseApi.js";
import { logout } from "../auth/authApi.js";

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
  createPurchase: vi.fn(),
  decideCooperation: vi.fn(),
  cancelProject: vi.fn(),
  login: vi.fn()
}));

vi.mock("../auth/authApi.js", () => ({
  logout: vi.fn()
}));

vi.mock("./BaseShell.js", () => ({
  BaseShell: ({ snapshot, actionFeedback, hasControl, onPurchase, onCooperationDecision, onLogout }: {
    snapshot: { baseId: string };
    actionFeedback: { message: string } | null;
    hasControl?: boolean;
    onPurchase: (itemId: string, quantity: number) => void;
    onCooperationDecision?: (requestId: string, action: "support" | "wait", expectedHelperOperatorId?: string) => void;
    onLogout?: () => void;
  }) => (
    <div data-testid="base-shell">
      基地 {snapshot.baseId}
      <button type="button" onClick={() => onPurchase("anchor", 1)}>测试采购</button>
      <button type="button" onClick={() => onCooperationDecision?.("request-1", "support", "operator-2")}>测试协作</button>
      <button type="button" onClick={() => onLogout?.()}>退出登录</button>
      <span data-testid="has-control">{String(hasControl)}</span>
      <span data-testid="command-feedback">{actionFeedback?.message}</span>
    </div>
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
    resources: [{ itemId: "spare_parts", name: "备件", quantity: 30, reservedQuantity: 0, reservationSources: [], description: "测试物资说明" }],
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
  vi.mocked(heartbeat).mockReset();
  vi.mocked(heartbeat).mockResolvedValue({ controlToken: null, leaseUntil: null, timeMode: "paused" });
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

  it("资源不足时刷新快照，并把服务端失败留给发起操作的工作区", async () => {
    vi.mocked(getSnapshot).mockResolvedValue(buildSnapshot());
    vi.mocked(createPurchase).mockRejectedValue(
      new BaseApiError(409, "RESOURCE_INSUFFICIENT", "物资不足，无法采购。")
    );
    render(<BaseApp initialCsrfToken="csrf-1" />);
    await screen.findByTestId("base-shell");
    fireEvent.click(screen.getByRole("button", { name: "测试采购" }));
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("command-feedback").textContent).toContain("物资不足，无法采购");
    expect(createPurchase).toHaveBeenCalledOnce();
  });

  it("采购回执与已提交快照给出付款、在途和到货时间", async () => {
    vi.mocked(getSnapshot)
      .mockResolvedValueOnce(buildSnapshot())
      .mockResolvedValue(buildSnapshot({
        credits: 485,
        purchases: [{
          purchaseId: "purchase-1", itemId: "anchor", itemName: "地锚", quantity: 1,
          costCredits: 15, status: "in_transit", arrivesAtSim: "2126-01-01T08:20:00.000Z"
        }]
      }));
    vi.mocked(createPurchase).mockResolvedValue({ purchaseId: "purchase-1", duplicate: false });
    render(<BaseApp initialCsrfToken="csrf-1" />);
    await screen.findByTestId("base-shell");

    fireEvent.click(screen.getByRole("button", { name: "测试采购" }));
    await waitFor(() => expect(screen.getByTestId("command-feedback").textContent)
      .toContain("地锚 ×1"));
    expect(screen.getByTestId("command-feedback").textContent).toContain("15 credits");
    expect(screen.getByTestId("command-feedback").textContent).toContain("在途");
  });

  it("协作决策用具名候选提交，操作处反馈实际接手者", async () => {
    const after = buildSnapshot({
      devices: [{
        deviceId: "device-2", operatorId: "operator-2", name: "驮运二号",
        groupId: "transport", description: "测试设备", status: "working",
        batteryWh: 900, batteryCapacityWh: 2000, currentAssignment: { projectId: "project-1", stepIndex: 1 }
      }]
    });
    vi.mocked(getSnapshot).mockResolvedValueOnce(buildSnapshot()).mockResolvedValue(after);
    vi.mocked(decideCooperation).mockResolvedValue({
      requestId: "request-1", status: "accepted", helperOperatorId: "operator-2", duplicate: false
    });
    render(<BaseApp initialCsrfToken="csrf-1" />);
    await screen.findByTestId("base-shell");

    fireEvent.click(screen.getByRole("button", { name: "测试协作" }));
    await waitFor(() => expect(screen.getByTestId("command-feedback").textContent).toContain("驮运二号跨组支援"));
    expect(decideCooperation).toHaveBeenCalledWith("request-1", expect.objectContaining({
      action: "support", expectedHelperOperatorId: "operator-2"
    }), "csrf-1");
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

  it("管理员登录把登录响应里的 user.role 传给 onAuthenticated，不得降级为 player", async () => {
    vi.mocked(getSnapshot)
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValue(buildSnapshot());
    vi.mocked(login).mockResolvedValue({
      user: { id: "account-admin", email: "admin@e.test", role: "admin", status: "active" },
      csrfToken: "csrf-admin"
    });
    vi.mocked(provision).mockResolvedValue({ baseId: "base-1", duplicate: true });
    const onAuthenticated = vi.fn();

    render(<BaseApp onAuthenticated={onAuthenticated} />);

    fireEvent.click(await screen.findByRole("tab", { name: "账号登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "admin@e.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并进入基地" }));

    expect(await screen.findByTestId("base-shell")).toBeTruthy();
    expect(onAuthenticated).toHaveBeenCalledWith({
      csrfToken: "csrf-admin",
      role: "admin",
      email: "admin@e.test"
    });
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

  it("登录前不发送心跳，前台获焦后 acquire 并续租，隐藏后 release", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
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
      controlToken: "control-1",
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
    expect(heartbeat).toHaveBeenCalledWith({ action: "acquire" }, "csrf-hb");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(heartbeat).toHaveBeenCalledWith({ action: "renew", controlToken: "control-1" }, "csrf-hb");

    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(heartbeat).toHaveBeenCalledWith({ action: "release", controlToken: "control-1" }, "csrf-hb");
    const calls = vi.mocked(heartbeat).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(heartbeat).toHaveBeenCalledTimes(calls);
    focus.mockRestore();
    visibility.mockRestore();
  });

  it("重新获焦拿新 token；旧续租迟到报错不能清掉新控制权", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    let rejectOldRenew: ((error: Error) => void) | undefined;
    let acquireCount = 0;
    vi.mocked(heartbeat).mockImplementation((input) => {
      if (input.action === "renew") {
        return new Promise((_resolve, reject) => { rejectOldRenew = reject; });
      }
      if (input.action === "acquire") acquireCount += 1;
      return Promise.resolve({
        controlToken: input.action === "acquire" ? `control-${acquireCount}` : null,
        leaseUntil: "2126-01-01T08:02:00.000Z", timeMode: "running"
      });
    });
    vi.mocked(getSnapshot).mockResolvedValue(buildSnapshot());
    render(<BaseApp initialCsrfToken="csrf-1" />);
    await act(async () => {});
    expect(getSnapshot).toHaveBeenCalledWith("control-1");

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    focus.mockReturnValue(false);
    await act(async () => { window.dispatchEvent(new Event("blur")); });
    focus.mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(heartbeat).toHaveBeenCalledWith({ action: "acquire" }, "csrf-1");
    expect(getSnapshot).toHaveBeenCalledWith("control-2");

    await act(async () => { rejectOldRenew?.(new BaseApiError(409, "CONTROL_EXPIRED", "旧控制权失效")); });
    expect(screen.getByTestId("has-control").textContent).toBe("true");
    focus.mockRestore();
  });
});

describe("BaseApp > 退出后不残留凭据（B006）", () => {
  it("退出后迟到的旧快照不能把上一账号基地重新显示出来", async () => {
    let finishOldRequest: ((snapshot: BaseSnapshotDto) => void) | undefined;
    vi.mocked(getSnapshot).mockResolvedValueOnce(buildSnapshot()).mockImplementationOnce(() =>
      new Promise((resolve) => { finishOldRequest = resolve; })
    );
    vi.mocked(logout).mockResolvedValue(undefined);
    render(<BaseApp />);
    await screen.findByTestId("base-shell");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByRole("button", { name: "领取试玩基地" })).toBeTruthy();
    await act(async () => { finishOldRequest?.(buildSnapshot()); });
    expect(screen.queryByTestId("base-shell")).toBeNull();
  });

  function authFields() {
    return {
      email: screen.getByLabelText("邮箱") as HTMLInputElement,
      password: screen.getByLabelText("密码") as HTMLInputElement
    };
  }

  function expectEmptyAuthForm(submitName: "领取试玩基地" | "登录并进入基地") {
    const { email, password } = authFields();
    expect(email.value).toBe("");
    expect(password.value).toBe("");
    expect((screen.getByRole("button", { name: submitName }) as HTMLButtonElement).disabled).toBe(true);
  }

  it.each([
    { mode: "account" as const, tab: "账号登录", submit: "登录并进入基地" as const },
    { mode: "register" as const, tab: "试玩注册", submit: "领取试玩基地" as const }
  ])(
    "$tab → 进入基地 → 退出登录后，邮箱与密码为空、提交禁用，切换页签也不带回旧值",
    async ({ mode, tab, submit }) => {
      vi.mocked(getSnapshot)
        .mockRejectedValueOnce(unauthorized())
        .mockResolvedValue(buildSnapshot());
      vi.mocked(login).mockResolvedValue({
        user: { id: "account-1", email: "p@e.test", role: "player", status: "active" },
        csrfToken: "csrf-2"
      });
      vi.mocked(playtestRegister).mockResolvedValue({
        user: { accountId: "account-1", email: "p@e.test" },
        baseId: "base-1",
        csrfToken: "csrf-2"
      });
      vi.mocked(provision).mockResolvedValue({ baseId: "base-1", duplicate: mode === "account" });
      vi.mocked(logout).mockResolvedValue(undefined);
      const onLogout = vi.fn();

      render(<BaseApp onLogout={onLogout} />);

      fireEvent.click(await screen.findByRole("tab", { name: tab }));
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "p@e.test" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret-password" } });
      fireEvent.click(screen.getByRole("button", { name: submit }));
      expect(await screen.findByTestId("base-shell")).toBeTruthy();

      // 退出后后续快照都应视为未登录（真实服务端会话已销毁）。
      vi.mocked(getSnapshot).mockRejectedValue(unauthorized());
      fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

      expect(await screen.findByRole("button", { name: submit })).toBeTruthy();
      expect(logout).toHaveBeenCalledOnce();
      expect(onLogout).toHaveBeenCalledOnce();
      expectEmptyAuthForm(submit);

      // 两个页签来回切换都不带回旧值，提交按钮始终禁用。
      fireEvent.click(screen.getByRole("tab", { name: "账号登录" }));
      expectEmptyAuthForm("登录并进入基地");
      fireEvent.click(screen.getByRole("tab", { name: "试玩注册" }));
      expectEmptyAuthForm("领取试玩基地");
      fireEvent.click(screen.getByRole("tab", { name: "账号登录" }));
      expectEmptyAuthForm("登录并进入基地");

      // 不输入任何内容直接提交，不会发出登录/注册请求（B006 复现步骤最后一步）。
      fireEvent.submit(screen.getByRole("button", { name: "登录并进入基地" }).closest("form")!);
      expect(login).toHaveBeenCalledTimes(mode === "account" ? 1 : 0);
      expect(playtestRegister).toHaveBeenCalledTimes(mode === "register" ? 1 : 0);
    }
  );

  it("会话在游戏中失效（401）回到登录面时，同样不残留上次输入的凭据", async () => {
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
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret-password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并进入基地" }));
    expect(await screen.findByTestId("base-shell")).toBeTruthy();

    // 会话过期：下一次快照 401，被动回到登录面（没有经过“退出登录”按钮）。
    vi.mocked(getSnapshot).mockRejectedValue(unauthorized());
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(await screen.findByRole("button", { name: "登录并进入基地" })).toBeTruthy();
    expectEmptyAuthForm("登录并进入基地");
  });

  it("登录后 provision 失败、随后由轮询进入基地的路径，退出时同样清空凭据与旧错误", async () => {
    vi.mocked(getSnapshot)
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValue(buildSnapshot());
    vi.mocked(login).mockResolvedValue({
      user: { id: "account-1", email: "p@e.test", role: "player", status: "active" },
      csrfToken: "csrf-2"
    });
    vi.mocked(provision).mockRejectedValue(new BaseApiError(503, "UNAVAILABLE", "基地分配失败，请重试。"));
    vi.mocked(logout).mockResolvedValue(undefined);

    render(<BaseApp />);

    fireEvent.click(await screen.findByRole("tab", { name: "账号登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "p@e.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret-password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并进入基地" }));
    expect((await screen.findByRole("alert")).textContent).toContain("基地分配失败");

    // 会话其实已建立：下一次轮询拿到快照，直接进入基地（没有走登录成功的清空路径）。
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByTestId("base-shell")).toBeTruthy();

    vi.mocked(getSnapshot).mockRejectedValue(unauthorized());
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByRole("button", { name: "登录并进入基地" })).toBeTruthy();
    expectEmptyAuthForm("登录并进入基地");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("停留在登录面时，后台轮询得到 401 不会清掉正在输入的内容", async () => {
    vi.mocked(getSnapshot).mockRejectedValue(unauthorized());

    render(<BaseApp />);

    fireEvent.click(await screen.findByRole("tab", { name: "账号登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "p@e.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "typing" } });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    const { email, password } = authFields();
    expect(email.value).toBe("p@e.test");
    expect(password.value).toBe("typing");
  });

  it("登录失败时保留已输入的邮箱与密码，便于直接改正重试", async () => {
    vi.mocked(getSnapshot).mockRejectedValue(unauthorized());
    vi.mocked(login).mockRejectedValue(new BaseApiError(401, "INVALID_CREDENTIALS", "邮箱或密码错误。"));

    render(<BaseApp />);

    fireEvent.click(await screen.findByRole("tab", { name: "账号登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "p@e.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并进入基地" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    const { email, password } = authFields();
    expect(email.value).toBe("p@e.test");
    expect(password.value).toBe("wrong-password");
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
