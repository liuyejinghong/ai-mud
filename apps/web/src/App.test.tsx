import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { getCurrentSession, logout } from "./features/auth/authApi.js";

vi.mock("./features/auth/authApi.js", () => ({
  getCurrentSession: vi.fn(),
  logout: vi.fn()
}));

const baseAppProps: Array<{ initialCsrfToken?: string | null; onLogout?: () => void }> = [];

vi.mock("./features/base/BaseApp.js", () => ({
  BaseApp: (props: { initialCsrfToken?: string | null; onLogout?: () => void }) => {
    baseAppProps.push(props);
    return (
      <main aria-label="基地工作区">
        <h1>火星先遣基地</h1>
      </main>
    );
  }
}));

vi.mock("./features/admin/AiCallAdmin.js", () => ({ AiCallAdmin: () => <h2>AI 调用日志</h2> }));
vi.mock("./features/admin/AiLayerStatusAdmin.js", () => ({ AiLayerStatusAdmin: () => <h2>AI 状态</h2> }));
vi.mock("./features/admin/AccountOpsAdmin.js", () => ({ AccountOpsAdmin: () => <h2>账号运营</h2> }));
vi.mock("./features/admin/ActivationCodeAdmin.js", () => ({
  ActivationCodeAdmin: () => <h2>激活码管理</h2>
}));
vi.mock("./features/admin/AssetLedgerHealthAdmin.js", () => ({
  AssetLedgerHealthAdmin: () => <h2>账本守恒</h2>
}));
vi.mock("./features/admin/EconomyAdmin.js", () => ({ EconomyAdmin: () => <h2>经济监控</h2> }));
vi.mock("./features/admin/NpcAdmin.js", () => ({ NpcAdmin: () => <h2>NPC 运行监控</h2> }));
vi.mock("./features/admin/NpcMemoryAdmin.js", () => ({ NpcMemoryAdmin: () => <h2>NPC 记忆</h2> }));
vi.mock("./features/admin/SystemAnnouncementAdmin.js", () => ({
  SystemAnnouncementAdmin: () => <h2>系统公告</h2>
}));
vi.mock("./features/admin/WorldHealthAdmin.js", () => ({
  WorldHealthAdmin: () => <h2>世界健康总览</h2>
}));

const session = {
  user: { id: "account-1", email: "player@example.test", role: "player" as const, status: "active" as const },
  csrfToken: "csrf"
};

const adminSession = {
  ...session,
  user: { ...session.user, role: "admin" as const }
};

afterEach(() => {
  baseAppProps.length = 0;
  cleanup();
});

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentSession).mockResolvedValue(session);
    vi.mocked(logout).mockResolvedValue(undefined);
  });

  it("shows only the base workspace to players", async () => {
    render(<App />);

    expect(await screen.findByRole("main", { name: "基地工作区" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "工作区切换" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("heading", { name: "世界健康总览" })).toBeNull();
  });

  it("passes the existing session csrf token into the base client", async () => {
    render(<App />);

    await screen.findByRole("main", { name: "基地工作区" });
    expect(baseAppProps.at(-1)?.initialCsrfToken).toBe("csrf");
    expect(typeof baseAppProps.at(-1)?.onLogout).toBe("function");
  });

  it("starts admins in the base workspace without mounting management content", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(adminSession);

    render(<App />);

    expect(await screen.findByRole("main", { name: "基地工作区" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "工作区切换" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "基地" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("heading", { name: "世界健康总览" })).toBeNull();
  });

  it("mounts one management panel on demand and removes it when returning to the base", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(adminSession);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));

    expect(screen.queryByRole("main", { name: "基地工作区" })).toBeNull();
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "世界健康总览" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "系统公告" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "系统公告" }));

    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "世界健康总览" })).toBeNull();
    expect(screen.getByRole("heading", { name: "系统公告" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "基地" }));

    expect(screen.getByRole("main", { name: "基地工作区" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByRole("heading", { name: "世界健康总览" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "系统公告" })).toBeNull();
  });

  // 车道 C2（ARCH-boundaries-01）：旧“世界重置”只作用于旧黑松世界、曾把共享 tick 时钟拨回 1970 令全部基地停产，
  // 管理台不再提供该页签。
  it("does not offer the legacy world reset tab in the management workspace", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(adminSession);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));

    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "世界重置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "重置黑松世界" })).toBeNull();
    expect(screen.getByRole("tab", { name: "系统公告" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "内容工坊" })).toBeTruthy();
  });

  // AUTH-01 回归（刷新 race）：session 晚到时，BaseApp 不得先以"未登录"形态挂载——
  // 它的 csrf 只在首次挂载时取 props，先挂载再恢复会让刷新后的基地永远拿不到 CSRF。
  it("mounts the base client only after session restore settles, carrying the restored csrf", async () => {
    let resolveSession: (value: typeof session) => void = () => undefined;
    vi.mocked(getCurrentSession).mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      })
    );

    render(<App />);

    expect(screen.queryByRole("main", { name: "基地工作区" })).toBeNull();
    expect(screen.getByRole("main", { name: "会话恢复中" })).toBeTruthy();

    resolveSession(session);

    expect(await screen.findByRole("main", { name: "基地工作区" })).toBeTruthy();
    expect(baseAppProps).toHaveLength(1);
    expect(baseAppProps[0]?.initialCsrfToken).toBe("csrf");
  });

  it("falls back to the guest base client without a csrf token when session restore fails", async () => {
    vi.mocked(getCurrentSession).mockRejectedValue(new Error("Not signed in"));

    render(<App />);

    await screen.findByRole("main", { name: "基地工作区" });
    expect(baseAppProps).toHaveLength(1);
    expect(baseAppProps[0]?.initialCsrfToken).toBeUndefined();
  });
});
