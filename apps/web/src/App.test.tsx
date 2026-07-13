import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    <button type="button" onClick={() => onLogout?.()}>
      退出登录
    </button>
  )
}));

vi.mock("./features/admin/AiCallAdmin.js", () => ({ AiCallAdmin: () => null }));
vi.mock("./features/admin/AiLayerStatusAdmin.js", () => ({ AiLayerStatusAdmin: () => null }));
vi.mock("./features/admin/AccountOpsAdmin.js", () => ({ AccountOpsAdmin: () => null }));
vi.mock("./features/admin/ActivationCodeAdmin.js", () => ({ ActivationCodeAdmin: () => null }));
vi.mock("./features/admin/AssetLedgerHealthAdmin.js", () => ({ AssetLedgerHealthAdmin: () => null }));
vi.mock("./features/admin/EconomyAdmin.js", () => ({ EconomyAdmin: () => null }));
vi.mock("./features/admin/NpcAdmin.js", () => ({ NpcAdmin: () => null }));
vi.mock("./features/admin/NpcMemoryAdmin.js", () => ({ NpcMemoryAdmin: () => null }));
vi.mock("./features/admin/SystemAnnouncementAdmin.js", () => ({
  SystemAnnouncementAdmin: () => null
}));
vi.mock("./features/admin/WorldHealthAdmin.js", () => ({ WorldHealthAdmin: () => null }));
vi.mock("./features/admin/WorldResetAdmin.js", () => ({ WorldResetAdmin: () => null }));

const session = {
  user: { id: "account-1", email: "player@example.test", role: "player" as const, status: "active" as const },
  csrfToken: "csrf"
};

describe("App", () => {
  beforeEach(() => {
    vi.mocked(getCurrentSession).mockResolvedValue(session);
    vi.mocked(logout).mockResolvedValue(undefined);
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
