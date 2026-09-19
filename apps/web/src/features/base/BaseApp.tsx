import { useCallback, useEffect, useState } from "react";
import type {
  BaseClockCommandInputDto,
  BaseSnapshotDto,
  CreateProjectInputDto
} from "@ai-mud/shared";
import {
  BaseApiError,
  createProject,
  cancelProject,
  getSnapshot,
  heartbeat,
  login,
  playtestRegister,
  provision,
  setClock
} from "./baseApi.js";
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

export function BaseApp({
  initialCsrfToken = null
}: { initialCsrfToken?: string | null } = {}) {
  const [phase, setPhase] = useState<BasePhase>("loading");
  const [snapshot, setSnapshot] = useState<BaseSnapshotDto | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(initialCsrfToken);
  const [authMode, setAuthMode] = useState<AuthPanelMode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionBusy, setIsActionBusy] = useState(false);

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const refreshSnapshot = useCallback(async () => {
    try {
      const next = await getSnapshot();
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
    return () => {
      window.clearInterval(timer);
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
      await provision();
      await refreshSnapshot();
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

  const handleSelectSite = useCallback((siteId: string) => {
    setSelectedSiteId(siteId);
    setSelectedProjectId(null);
    setSelectedDeviceId(null);
  }, []);

  const handleSelectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedSiteId(null);
    setSelectedDeviceId(null);
  }, []);

  const handleSelectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setSelectedSiteId(null);
    setSelectedProjectId(null);
  }, []);

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

  return (
    <>
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
        isBusy={isActionBusy}
      />
    </>
  );
}
