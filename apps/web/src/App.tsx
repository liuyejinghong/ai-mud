import { useEffect, useState } from "react";
import { getCurrentSession, type AuthSessionDto } from "./features/auth/authApi";
import { BaseApp } from "./features/base/BaseApp";
import { AdminShell } from "./features/game/ui/AdminShell";

type Workspace = "game" | "admin";

export function App() {
  const [session, setSession] = useState<AuthSessionDto | null>(null);
  // 会话恢复未完成前不挂载 BaseApp：BaseApp 的 csrf 只在首次挂载时从 props 取值，
  // 若先以"未登录"形态挂载、session 稍后到达，刷新后的基地会永远拿不到 CSRF（恢复计时等按钮禁用）。
  // 先等 /auth/me 落定，再以最终会话一次性挂载，是唯一的会话事实来源。
  const [restoringSession, setRestoringSession] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>("game");

  function authenticate(input: {
    csrfToken: string;
    role: string;
    email: string;
  }) {
    setActiveWorkspace("game");
    setSession({
      user: {
        id: input.email,
        email: input.email,
        role: input.role as AuthSessionDto["user"]["role"],
        status: "active"
      },
      csrfToken: input.csrfToken
    });
  }

  function expireSession() {
    setActiveWorkspace("game");
    setSession(null);
  }

  useEffect(() => {
    let cancelled = false;

    void getCurrentSession()
      .then((currentSession) => {
        if (!cancelled) setSession(currentSession);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setRestoringSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (restoringSession) {
    return (
      <main className="base-shell base-loading" aria-label="会话恢复中">
        <p className="base-copy">正在恢复会话…</p>
        <p className="base-copy">首次加载可能需要几十秒，请稍候。</p>
      </main>
    );
  }

  // v1.0：未登录也直接进基地客户端——注册/登录都在 BaseApp 内完成，
  // 不再有第二张登录页（AuthPage 已下架）。
  if (!session) {
    // 未登录：注册/登录都在 BaseApp 内完成；管理员登录成功后由 onAuthenticated 抬升到管理台。
    return (
      <BaseApp
        onAuthenticated={authenticate}
        onLogout={expireSession}
      />
    );
  }

  const isAdmin = session.user.role === "admin" || session.user.role === "super_admin";
  // v0.12：玩家默认进入火星基地客户端；旧西幻 GameShell 归档保留（管理员工作区可切换）。
  const baseApp = (
    <BaseApp
      initialCsrfToken={session.csrfToken}
      initialAccountEmail={session.user.email}
      onLogout={expireSession}
    />
  );

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
