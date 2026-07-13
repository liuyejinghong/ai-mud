import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { getCurrentSession, logout } from "./features/auth/authApi.js";

vi.mock("./features/auth/authApi.js", () => ({
  getCurrentSession: vi.fn(),
  logout: vi.fn()
}));

vi.mock("./features/auth/AuthPage.js", () => ({
  AuthPage: () => <h1>AI MUD 内测登录</h1>
}));

vi.mock("./features/game/GameShell.js", () => ({
  GameShell: ({ onLogout }: { onLogout?: () => void }) => (
    <main aria-label="游戏工作区">
      <h1>黑松镇</h1>
      <button type="button" onClick={() => onLogout?.()}>
        退出登录
      </button>
    </main>
  )
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
vi.mock("./features/admin/WorldResetAdmin.js", () => ({ WorldResetAdmin: () => <h2>世界重置</h2> }));

const session = {
  user: { id: "account-1", email: "player@example.test", role: "player" as const, status: "active" as const },
  csrfToken: "csrf"
};

const adminSession = {
  ...session,
  user: { ...session.user, role: "admin" as const }
};

afterEach(cleanup);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentSession).mockResolvedValue(session);
    vi.mocked(logout).mockResolvedValue(undefined);
  });

  it("shows only the game workspace to players", async () => {
    render(<App />);

    expect(await screen.findByRole("main", { name: "游戏工作区" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "工作区切换" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("heading", { name: "世界健康总览" })).toBeNull();
  });

  it("starts admins in the game workspace without mounting management content", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(adminSession);

    render(<App />);

    expect(await screen.findByRole("main", { name: "游戏工作区" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "工作区切换" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "游戏" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("heading", { name: "世界健康总览" })).toBeNull();
  });

  it("mounts one management panel on demand and removes it when returning to the game", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(adminSession);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));

    expect(screen.queryByRole("main", { name: "游戏工作区" })).toBeNull();
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "世界健康总览" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "系统公告" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "系统公告" }));

    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "世界健康总览" })).toBeNull();
    expect(screen.getByRole("heading", { name: "系统公告" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "游戏" }));

    expect(screen.getByRole("main", { name: "游戏工作区" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByRole("heading", { name: "世界健康总览" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "系统公告" })).toBeNull();
  });

  it("ends the session from the player shell before returning to login", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledOnce();
      expect(screen.getByRole("heading", { name: "AI MUD 内测登录" })).toBeTruthy();
    });
  });
});
