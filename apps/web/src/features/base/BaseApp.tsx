import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BaseClockCommandInputDto,
  BaseSnapshotDto,
  CreateManufacturingJobInputDto,
  CreateProjectInputDto
} from "@ai-mud/shared";
import {
  acceptOrder,
  BaseApiError,
  cancelManufacturingJob,
  createPurchase,
  deliverOrder,
  createManufacturingJob,
  createProject,
  cancelProject,
  getSnapshot,
  heartbeat,
  login,
  playtestRegister,
  provision,
  setClock
} from "./baseApi.js";
import { logout } from "../auth/authApi.js";
import { BaseIntroModal } from "./BaseIntroModal.js";
import { BaseShell } from "./BaseShell.js";

const SNAPSHOT_POLL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

type BasePhase = "loading" | "unauthenticated" | "ready";
type AuthPanelMode = "register" | "login";

function describeError(error: unknown): string {
  if (error instanceof BaseApiError) {
    return error.message;
  }
  return "操作失败，请稍后再试。";
}

interface AuthPanelProps {
  mode: AuthPanelMode;
  email: string;
  password: string;
  isBusy: boolean;
  error: string | null;
  onModeChange: (mode: AuthPanelMode) => void;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onSubmit: () => void;
}

function AuthPanel({
  mode,
  email,
  password,
  isBusy,
  error,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onSubmit
}: AuthPanelProps) {
  const canSubmit = email.trim().length > 0 && password.length > 0 && !isBusy;

  return (
    <main className="base-shell base-auth" aria-label="基地登录">
      <section className="base-panel base-auth-panel" aria-labelledby="base-auth-title">
        <p className="base-kicker">垦荒前哨</p>
        <h1 id="base-auth-title">进入你的基地</h1>
        <p className="base-copy">
          在这里安排机器人施工、盯紧电力和物资，把荒地一点点建成前哨站。先领取一个试玩基地，或用已有账号登录。
        </p>

        <div className="base-auth-switch" role="tablist" aria-label="登录方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            disabled={isBusy}
            onClick={() => onModeChange("register")}
          >
            试玩注册
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            disabled={isBusy}
            onClick={() => onModeChange("login")}
          >
            账号登录
          </button>
        </div>

        <form
          className="base-auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onSubmit();
          }}
        >
          <label className="base-field" htmlFor="base-auth-email">
            邮箱
            <input
              id="base-auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
            />
          </label>
          <label className="base-field" htmlFor="base-auth-password">
            密码
            <input
              id="base-auth-password"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </label>

          <button type="submit" className="base-primary-button" disabled={!canSubmit}>
            {isBusy
              ? "请稍候…"
              : mode === "register"
                ? "领取试玩基地"
                : "登录并进入基地"}
          </button>
        </form>

        {error ? (
          <p role="alert" className="base-error">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

export interface BaseAuthenticatedSession {
  csrfToken: string;
  role: string;
  email: string;
}

export function BaseApp({
  initialCsrfToken = null,
  onLogout,
  onAuthenticated
}: {
  initialCsrfToken?: string | null;
  onLogout?: () => void;
  onAuthenticated?: (session: BaseAuthenticatedSession) => void;
} = {}) {
  const [phase, setPhase] = useState<BasePhase>("loading");
  const [snapshot, setSnapshot] = useState<BaseSnapshotDto | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(initialCsrfToken);
  const [authMode, setAuthMode] = useState<AuthPanelMode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completionBanner, setCompletionBanner] = useState<string | null>(null);
  const completedSeenRef = useRef<Set<string>>(new Set());
  const hasPrevSnapshotRef = useRef(false);
  const [isActionBusy, setIsActionBusy] = useState(false);

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [introDismissed, setIntroDismissed] = useState(() => globalThis.localStorage?.getItem("base-intro-dismissed") === "1");

  const refreshSnapshot = useCallback(async () => {
    try {
      const next = await getSnapshot();
      // 完工提示：对比上一轮快照，新出现的已完成项目横幅告知（等待期的关键反馈）。
      // 冷启动（首次拉到快照）只静默记住已完成集合，不横幅——历史完工不该在登录时轰炸。
      if (hasPrevSnapshotRef.current) {
        const fresh = next.projects.find(
          (project) =>
            project.status === "completed" && !completedSeenRef.current.has(project.projectId)
        );
        if (fresh !== undefined) {
          setCompletionBanner(`${fresh.name}已完工，基地能力提升。`);
        }
      }
      hasPrevSnapshotRef.current = true;
      for (const project of next.projects) {
        if (project.status === "completed") completedSeenRef.current.add(project.projectId);
      }
      setSnapshot(next);
      setPhase("ready");
      return next;
    } catch (error) {
      if (error instanceof BaseApiError && error.status === 401) {
        setPhase("unauthenticated");
      }
      return null;
    }
  }, []);

  // 挂载后每 5 秒轮询快照；仅页面可见时拉取，避免后台标签页空转。
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      void refreshSnapshot();
    };
    void refreshSnapshot();
    const timer = window.setInterval(poll, SNAPSHOT_POLL_MS);
    // 切回页面立即刷新一次，避免看到后台期间暂停轮询留下的陈旧数据。
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshSnapshot]);

  // 每 30 秒心跳续租一次；没有 csrfToken（例如用旧会话直接打开）时静默跳过。
  useEffect(() => {
    if (csrfToken === null) return;
    const timer = window.setInterval(() => {
      void heartbeat(csrfToken).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [csrfToken]);

  const handleAuthSubmit = async () => {
    setIsAuthBusy(true);
    setAuthError(null);
    try {
      const credentials = { email: email.trim(), password };
      const session =
        authMode === "register"
          ? await playtestRegister(credentials)
          : await login(credentials);
      setCsrfToken(session.csrfToken);
      // provision 幂等：注册响应里已有基地，也照样调用一次确保就绪。
      // 必须带刚拿到的 CSRF 头，否则写路由 403，只能等轮询兜底进基地。
      await provision(session.csrfToken);
      await refreshSnapshot();
      // 通知 App 层（管理员由此进入管理台；玩家保持原地）。
      onAuthenticated?.({
        csrfToken: session.csrfToken,
        // 登录响应的 role 在 user 对象里；读顶层会把管理员降级成 player，
        // 页面登录后要再手动刷新一次才能进管理台。
        role:
          authMode === "register"
            ? "player"
            : ((session as { user?: { role?: string } }).user?.role ?? "player"),
        email:
          authMode === "register"
            ? session.user.email
            : ((session as { user?: { email?: string }; accountId?: string }).user?.email ??
              (session as { accountId?: string }).accountId ??
              "")
      });
    } catch (error) {
      setAuthError(describeError(error));
    } finally {
      setIsAuthBusy(false);
    }
  };

  const runCommand = useCallback(
    async (command: () => Promise<unknown>) => {
      setIsActionBusy(true);
      setActionError(null);
      try {
        await command();
        await refreshSnapshot();
      } catch (error) {
        setActionError(describeError(error));
      } finally {
        setIsActionBusy(false);
      }
    },
    [refreshSnapshot]
  );

  const handleCreateProject = useCallback(
    (input: CreateProjectInputDto) => {
      if (csrfToken === null) return;
      void runCommand(() => createProject(input, csrfToken));
    },
    [csrfToken, runCommand]
  );

  const handleCancelProject = useCallback(
    (projectId: string) => {
      if (csrfToken === null) return;
      void runCommand(() => cancelProject(projectId, crypto.randomUUID(), csrfToken));
    },
    [csrfToken, runCommand]
  );

  const handleClockCommand = useCallback(
    (input: BaseClockCommandInputDto) => {
      if (csrfToken === null) return;
      void runCommand(() => setClock(input, csrfToken));
    },
    [csrfToken, runCommand]
  );

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } finally {
      // 退出即回到登录面并丢弃本地会话态（CSRF/快照），不等下一次快照 401 兜底；
      // 避免退出/换号窗口里沿用旧 CSRF 或旧基地画面。
      setCsrfToken(null);
      setSnapshot(null);
      setPhase("unauthenticated");
      setSelectedResourceId(null);
      setSelectedSiteId(null);
      setSelectedProjectId(null);
      setSelectedDeviceId(null);
      onLogout?.();
    }
  }, [onLogout]);

  const handleSelectSite = useCallback((siteId: string) => {
    setSelectedSiteId(siteId);
    setSelectedProjectId(null);
    setSelectedDeviceId(null);
    setSelectedResourceId(null);
  }, []);

  const handleSelectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedSiteId(null);
    setSelectedDeviceId(null);
    setSelectedResourceId(null);
  }, []);

  const handleSelectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setSelectedSiteId(null);
    setSelectedProjectId(null);
    setSelectedResourceId(null);
  }, []);

  const handleSelectResource = useCallback((itemId: string) => {
    setSelectedResourceId((current) => (current === itemId ? null : itemId));
    setSelectedSiteId(null);
    setSelectedProjectId(null);
    setSelectedDeviceId(null);
  }, []);

  const handleCreateJob = useCallback(
    (input: CreateManufacturingJobInputDto) => {
      if (csrfToken === null) return;
      void runCommand(() => createManufacturingJob(input, csrfToken));
    },
    [csrfToken, runCommand]
  );

  const handleCancelJob = useCallback(
    (jobId: string) => {
      if (csrfToken === null) return;
      void runCommand(() => cancelManufacturingJob(jobId, crypto.randomUUID(), csrfToken));
    },
    [csrfToken, runCommand]
  );

  const handleSelectJob = useCallback((jobId: string) => {
    setSelectedJobId((current) => (current === jobId ? null : jobId));
    setSelectedSiteId(null);
    setSelectedProjectId(null);
    setSelectedDeviceId(null);
    setSelectedResourceId(null);
  }, []);

  const handleSelectOrder = useCallback((orderId: string) => {
    setSelectedOrderId((current) => (current === orderId ? null : orderId));
    setSelectedSiteId(null);
    setSelectedProjectId(null);
    setSelectedDeviceId(null);
    setSelectedResourceId(null);
    setSelectedJobId(null);
  }, []);

  const handleAcceptOrder = useCallback(
    (orderId: string) => {
      if (csrfToken === null) return;
      void runCommand(() => acceptOrder(orderId, crypto.randomUUID(), csrfToken));
    },
    [csrfToken, runCommand]
  );

  const handleDeliverOrder = useCallback(
    (orderId: string) => {
      if (csrfToken === null) return;
      void runCommand(() => deliverOrder({ orderId, commandId: crypto.randomUUID() }, csrfToken));
    },
    [csrfToken, runCommand]
  );

  const handlePurchase = useCallback(
    (itemId: string, quantity: number) => {
      if (csrfToken === null) return;
      void runCommand(() =>
        createPurchase({ itemId, quantity, commandId: crypto.randomUUID() }, csrfToken)
      );
    },
    [csrfToken, runCommand]
  );

  if (phase !== "ready" || snapshot === null) {
    if (phase === "unauthenticated") {
      return (
        <AuthPanel
          mode={authMode}
          email={email}
          password={password}
          isBusy={isAuthBusy}
          error={authError}
          onModeChange={setAuthMode}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onSubmit={() => void handleAuthSubmit()}
        />
      );
    }
    return (
      <main className="base-shell base-loading" aria-label="基地加载中">
        <p className="base-copy">正在连接基地…</p>
      </main>
    );
  }

  // 新手引导：首次进入（还没有任何项目）时显示剧情弹窗；开工后不再打扰。
  const showIntro = snapshot !== null && snapshot.projects.length === 0 && !introDismissed;
  return (
    <>
      {showIntro ? (
        <BaseIntroModal
          baseName={snapshot.name}
          onDismiss={() => {
            setIntroDismissed(true);
            globalThis.localStorage?.setItem("base-intro-dismissed", "1");
          }}
        />
      ) : null}
      {completionBanner ? (
        <div className="base-completion-banner" role="status">
          <span>{completionBanner}</span>
          <button
            type="button"
            aria-label="关闭完工提示"
            onClick={() => setCompletionBanner(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className="base-error base-action-error">
          {actionError}
        </p>
      ) : null}
      <BaseShell
        snapshot={snapshot}
        csrfToken={csrfToken}
        selectedSiteId={selectedSiteId}
        selectedProjectId={selectedProjectId}
        selectedDeviceId={selectedDeviceId}
        onSelectSite={handleSelectSite}
        onSelectProject={handleSelectProject}
        onSelectDevice={handleSelectDevice}
        onCreateProject={handleCreateProject}
        onCancelProject={handleCancelProject}
        onClockCommand={handleClockCommand}
        onSetSpeed={(speed) => handleClockCommand({ command: "set_speed", speed })}
        onSelectResource={handleSelectResource}
        selectedResourceId={selectedResourceId}
        onCreateJob={handleCreateJob}
        onCancelJob={handleCancelJob}
        onSelectJob={handleSelectJob}
        selectedJobId={selectedJobId}
        onAcceptOrder={handleAcceptOrder}
        onDeliverOrder={handleDeliverOrder}
        onPurchase={handlePurchase}
        onSelectOrder={handleSelectOrder}
        selectedOrderId={selectedOrderId}
        onLogout={() => void handleLogout()}
        isBusy={isActionBusy}
      />
    </>
  );
}
