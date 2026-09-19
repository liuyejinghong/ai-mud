import { useEffect, useState } from "react";
import { AuthPage } from "./features/auth/AuthPage";
import { getCurrentSession, logout, type AuthSessionDto } from "./features/auth/authApi";
import { BaseApp } from "./features/base/BaseApp";
import { AdminShell } from "./features/game/ui/AdminShell";

type Workspace = "game" | "admin";

export function App() {
  const [session, setSession] = useState<AuthSessionDto | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>("game");

  function authenticate(nextSession: AuthSessionDto) {
    setActiveWorkspace("game");
    setSession(nextSession);
  }

  function expireSession() {
    setActiveWorkspace("game");
    setSession(null);
  }

  async function endSession() {
    await logout();
    expireSession();
  }

  useEffect(() => {
    let cancelled = false;

    void getCurrentSession()
      .then((currentSession) => {
        if (!cancelled) setSession(currentSession);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!session) {
    return <AuthPage onAuthenticated={authenticate} />;
  }

  const isAdmin = session.user.role === "admin" || session.user.role === "super_admin";
  // v0.12：玩家默认进入火星基地客户端；旧西幻 GameShell 归档保留（管理员工作区可切换）。
  const baseApp = <BaseApp initialCsrfToken={session.csrfToken} onLogout={endSession} />;

  if (!isAdmin) {
    return baseApp;
  }

  return (
    <div className="workspace-layout">
      <header className="workspace-toolbar">
        <nav className="workspace-switcher" aria-label="工作区切换">
          <button
            type="button"
            aria-pressed={activeWorkspace === "game"}
            onClick={() => setActiveWorkspace("game")}
          >
            基地
          </button>
          <button
            type="button"
            aria-pressed={activeWorkspace === "admin"}
            onClick={() => setActiveWorkspace("admin")}
          >
            管理
          </button>
        </nav>
      </header>
      {activeWorkspace === "admin" ? <AdminShell csrfToken={session.csrfToken} /> : baseApp}
    </div>
  );
}
