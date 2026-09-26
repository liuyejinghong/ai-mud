import { newCommandId } from "../../lib/uuid.js";
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
  decideCooperation,
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
import type { BaseActionFeedback } from "./BaseShell.js";

const SNAPSHOT_POLL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

function isForeground(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

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
  initialAccountEmail = null,
  initialCsrfToken = null,
  onLogout,
  onAuthenticated
}: {
  initialAccountEmail?: string | null;
  initialCsrfToken?: string | null;
  onLogout?: () => void;
  onAuthenticated?: (session: BaseAuthenticatedSession) => void;
} = {}) {
  const [phase, setPhase] = useState<BasePhase>("loading");
  const [snapshot, setSnapshot] = useState<BaseSnapshotDto | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(initialCsrfToken);
  const [accountEmail, setAccountEmail] = useState<string | null>(initialAccountEmail ?? null);
  const [authMode, setAuthMode] = useState<AuthPanelMode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // 登录表单状态挂在 BaseApp 上而不是 AuthPanel 里；App 在登录/未登录两种形态下
  // 都在同一位置渲染 BaseApp，实例（连同这里的 state）会跨越“登录→退出”保留。
  // 所以凭据必须显式清空，不能指望 AuthPanel 卸载重建（B006）。
  const clearAuthForm = useCallback(() => {
    setEmail("");
    setPassword("");
    setAuthError(null);
  }, []);
  const [actionFeedback, setActionFeedback] = useState<BaseActionFeedback | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [completionBanner, setCompletionBanner] = useState<string | null>(null);
  const completedSeenRef = useRef<Set<string>>(new Set());
  const hasPrevSnapshotRef = useRef(false);
  const baseIdRef = useRef<string | null>(null);
  const snapshotSeqRef = useRef(0);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [controlToken, setControlToken] = useState<string | null>(null);
  const controlTokenRef = useRef<string | null>(null);
  const controlGenerationRef = useRef(0);
  const acquiringRef = useRef<Promise<string | null> | null>(null);
  const foregroundRef = useRef(false);

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [introDismissed, setIntroDismissed] = useState(false);

  const releaseControl = useCallback((csrf: string | null) => {
    controlGenerationRef.current += 1;
    acquiringRef.current = null;
    const token = controlTokenRef.current;
    controlTokenRef.current = null;
    setControlToken(null);
    return token && csrf
      ? heartbeat({ action: "release", controlToken: token }, csrf).then(() => undefined, () => undefined)
      : Promise.resolve();
  }, []);

  const acquireControl = useCallback((csrf: string, force = false): Promise<string | null> => {
    if (!isForeground()) return Promise.resolve(null);
    if (force) {
      controlGenerationRef.current += 1;
      acquiringRef.current = null;
      controlTokenRef.current = null;
      setControlToken(null);
    }
    if (controlTokenRef.current) return Promise.resolve(controlTokenRef.current);
    if (acquiringRef.current) return acquiringRef.current;
    const generation = controlGenerationRef.current;
    const acquiring = heartbeat({ action: "acquire" }, csrf).then((result) => {
      const token = result.controlToken;
      if (!token) return null;
      if (generation !== controlGenerationRef.current || !isForeground()) {
        void heartbeat({ action: "release", controlToken: token }, csrf).catch(() => undefined);
        return null;
      }
      controlTokenRef.current = token;
      setControlToken(token);
      return token;
    }).finally(() => {
      if (acquiringRef.current === acquiring) acquiringRef.current = null;
    });
    acquiringRef.current = acquiring;
    return acquiring;
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const seq = ++snapshotSeqRef.current;
    const token = controlTokenRef.current;
    try {
      const next = await getSnapshot(token ?? undefined);
      if (seq !== snapshotSeqRef.current || token !== controlTokenRef.current) return null;
      if (baseIdRef.current !== null && baseIdRef.current !== next.baseId) {
        completedSeenRef.current.clear();
        hasPrevSnapshotRef.current = false;
        setCompletionBanner(null);
        setSelectedSiteId(null);
        setSelectedProjectId(null);
        setSelectedDeviceId(null);
        setSelectedResourceId(null);
        setSelectedJobId(null);
        setActionFeedback(null);
      }
      baseIdRef.current = next.baseId;
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
      setSnapshotError(null);
      setPhase("ready");
      return next;
    } catch (error) {
      if (seq !== snapshotSeqRef.current || token !== controlTokenRef.current) return null;
      if (error instanceof BaseApiError && error.status === 401) {
        // 不要在这里清空登录表单：停留在登录面时轮询仍每 5 秒走到这里，
        // 会抹掉玩家正在输入的内容。凭据在登录成功与退出时清空（B006）。
        setPhase("unauthenticated");
        setCsrfToken(null);
        setSnapshot(null);
        controlGenerationRef.current += 1;
        controlTokenRef.current = null;
        setControlToken(null);
        baseIdRef.current = null;
        setSelectedSiteId(null);
        setSelectedProjectId(null);
        setSelectedDeviceId(null);
        setSelectedResourceId(null);
        setSelectedJobId(null);
        setActionFeedback(null);
      } else {
        // 非会话失效的快照失败必须给可见反馈：首载卡在"连接中"、轮询静默失败会留下
        // 无从恢复的陈旧画面（SYNC-01）。
        setSnapshotError(describeError(error));
      }
      return null;
    }
  }, []);

  // 首次前台快照在 acquire 后读取；轮询只读已提交的服务端事实。
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== "visible" || acquiringRef.current) return;
      void refreshSnapshot();
    };
    void (async () => {
      if (initialCsrfToken && isForeground()) {
        await acquireControl(initialCsrfToken).catch(() => null);
      }
      await refreshSnapshot();
    })();
    const timer = window.setInterval(poll, SNAPSHOT_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshSnapshot, acquireControl, initialCsrfToken]);

  // 只有可见且获焦的标签续租；离开时尽力结清并交出控制权。
  useEffect(() => {
    if (csrfToken === null) return;
    foregroundRef.current = isForeground();
    const enter = () => {
      if (!isForeground() || foregroundRef.current) return;
      foregroundRef.current = true;
      void acquireControl(csrfToken, true).catch(() => null).then(() => {
        void refreshSnapshot();
      });
    };
    const leave = () => {
      if (!isForeground() && foregroundRef.current) {
        foregroundRef.current = false;
        void releaseControl(csrfToken);
      }
    };
    const onVisibility = () => isForeground() ? enter() : leave();
    window.addEventListener("focus", enter);
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => {
      const token = controlTokenRef.current;
      if (!isForeground() || !token) return;
      void heartbeat({ action: "renew", controlToken: token }, csrfToken).catch((error) => {
        if (error instanceof BaseApiError && error.code === "CONTROL_EXPIRED" && controlTokenRef.current === token) {
          controlGenerationRef.current += 1;
          controlTokenRef.current = null;
          setControlToken(null);
          void refreshSnapshot();
        }
      });
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", enter);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      foregroundRef.current = false;
      void releaseControl(csrfToken);
    };
  }, [csrfToken, acquireControl, refreshSnapshot, releaseControl]);

  const handleAuthSubmit = async () => {
    setIsAuthBusy(true);
    setAuthError(null);
    try {
      const credentials = { email: email.trim(), password };
      const session =
        authMode === "register"
          ? await playtestRegister(credentials)
          : await login(credentials);
      snapshotSeqRef.current += 1;
      setCsrfToken(session.csrfToken);
      setAccountEmail(session.user.email);
      // provision 幂等：注册响应里已有基地，也照样调用一次确保就绪。
      // 必须带刚拿到的 CSRF 头，否则写路由 403，只能等轮询兜底进基地。
      await provision(session.csrfToken);
      await acquireControl(session.csrfToken).catch(() => null);
      await refreshSnapshot();
      // 会话已建立：凭据用完即弃。否则会话在游戏中过期（快照 401）被动回到登录面时，
      // 表单会带着上次的邮箱和密码，下一个人一键即可登录（B006）。
      // 失败路径（catch）保留输入，便于改正重试。
      clearAuthForm();
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
    async <T,>(
      command: () => Promise<T>,
      area: BaseActionFeedback["area"],
      describeResult: (result: T, next: BaseSnapshotDto) => string,
      usedControlToken?: string
    ) => {
      const commandBaseId = baseIdRef.current;
      setIsActionBusy(true);
      setActionFeedback({ area, kind: "pending", message: "正在处理请求…" });
      try {
        const result = await command();
        const next = await refreshSnapshot();
        if (baseIdRef.current === commandBaseId) {
          setActionFeedback({
            area,
            kind: "success",
            message: next ? describeResult(result, next) : "命令已提交；基地状态暂未更新，请稍后刷新。"
          });
        }
      } catch (error) {
        if (error instanceof BaseApiError && error.code === "CONTROL_EXPIRED" &&
          usedControlToken && controlTokenRef.current === usedControlToken) {
          controlGenerationRef.current += 1;
          controlTokenRef.current = null;
          setControlToken(null);
        }
        if (error instanceof BaseApiError && ["RESOURCE_INSUFFICIENT", "REVISION_EXPIRED", "CONTROL_EXPIRED"].includes(error.code)) {
          await refreshSnapshot();
        }
        if (baseIdRef.current === commandBaseId) {
          setActionFeedback({
            area, kind: "error",
            message: error instanceof BaseApiError && error.code === "REVISION_EXPIRED"
              ? `${describeError(error)} 状态已刷新，请核对后重试。`
              : describeError(error)
          });
        }
      } finally {
        setIsActionBusy(false);
      }
    },
    [refreshSnapshot]
  );

  const handleCreateProject = useCallback(
    (input: CreateProjectInputDto) => {
      if (csrfToken === null) return;
      void runCommand(() => createProject(input, csrfToken), "base", (result, next) => {
        const project = next.projects.find((item) => item.projectId === result.projectId);
        return project
          ? `工程「${project.name}」${result.duplicate ? "已存在" : "已创建"}，当前${project.status === "active" ? "施工中" : "准备中"}。`
          : "工程命令已提交，等待项目出现在基地状态中。";
      });
    },
    [csrfToken, runCommand]
  );

  const handleCancelProject = useCallback(
    (projectId: string) => {
      if (csrfToken === null) return;
      void runCommand(() => cancelProject(projectId, newCommandId(), csrfToken), "base", (result) => {
        if (result.completed) return "工程已经完工，无法再取消。";
        const returned = result.releasedInputs.reduce((sum, input) => sum + input.quantity, 0);
        return result.cancelled ? `工程已取消，退回未耗材料 ${returned} 件。` : "工程取消请求已记录。";
      });
    },
    [csrfToken, runCommand]
  );

  const handleClockCommand = useCallback(
    (input: BaseClockCommandInputDto, area: "base" | "clock" = "clock") => {
      const token = controlTokenRef.current;
      if (csrfToken === null || token === null) return;
      void runCommand(
        () => setClock(input, csrfToken, token),
        area,
        (result) => result.timeMode === "paused"
          ? "基地时间已暂停；离开后不会补算。"
          : `基地已按 ×${result.speed} 计时；当前基地时间 ${result.simTime.slice(11, 16)}。`,
        token
      );
    },
    [csrfToken, runCommand]
  );

  const handleLogout = useCallback(async () => {
    try {
      await releaseControl(csrfToken);
      await logout();
    } finally {
      // 退出即回到登录面并丢弃本地会话态（CSRF/快照/引导态），不等下一次快照 401 兜底；
      // 避免退出/换号窗口里沿用旧 CSRF、旧基地画面或跳过引导。
      setCsrfToken(null);
      snapshotSeqRef.current += 1;
      setAccountEmail(null);
      setSnapshot(null);
      baseIdRef.current = null;
      completedSeenRef.current.clear();
      hasPrevSnapshotRef.current = false;
      setCompletionBanner(null);
      setActionFeedback(null);
      setPhase("unauthenticated");
      setIntroDismissed(false);
      setSelectedResourceId(null);
      setSelectedSiteId(null);
      setSelectedProjectId(null);
      setSelectedDeviceId(null);
      setSelectedJobId(null);
      // 退出后登录表单必须为空、提交禁用（B006）：共享设备上下一个人不能一键登录。
      clearAuthForm();
      onLogout?.();
    }
  }, [onLogout, clearAuthForm, releaseControl, csrfToken]);

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
      void runCommand(() => createManufacturingJob(input, csrfToken), "manufacturing", (result, next) => {
        const job = next.manufacturingJobs.find((item) => item.jobId === result.jobId);
        return job
          ? `制造工单「${job.recipeName}」${result.duplicate ? "已存在" : "已创建"}，计划 ${job.outputsPlanned} 台；产出 ${job.outputsDone} 台。`
          : "制造命令已提交，等待工单出现在基地状态中。";
      });
    },
    [csrfToken, runCommand]
  );

  const handleCancelJob = useCallback(
    (jobId: string) => {
      if (csrfToken === null) return;
      void runCommand(() => cancelManufacturingJob(jobId, newCommandId(), csrfToken), "manufacturing", (result) => {
        const returned = result.releasedInputs.reduce((sum, input) => sum + input.quantity, 0);
        return result.cancelled ? `制造工单已取消，退回未耗材料 ${returned} 件。` : "工单取消请求已记录。";
      });
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

  const handleAcceptOrder = useCallback(
    (orderId: string) => {
      if (csrfToken === null) return;
      void runCommand(() => acceptOrder(orderId, newCommandId(), csrfToken), "economy", (result, next) => {
        const order = next.orders.find((item) => item.orderId === orderId);
        return result.accepted && order
          ? `已接下「${order.name}」，交付 ${order.requiredItemName} ×${order.quantity} 可得 ${order.rewardCredits} credits。`
          : "接单命令已提交，请核对订单状态。";
      });
    },
    [csrfToken, runCommand]
  );

  const handleDeliverOrder = useCallback(
    (orderId: string) => {
      if (csrfToken === null) return;
      void runCommand(() => deliverOrder({ orderId, commandId: newCommandId() }, csrfToken), "economy", (result, next) => {
        const order = next.orders.find((item) => item.orderId === orderId);
        return result.delivered && order?.status === "delivered"
          ? `订单「${order.name}」已交付，获得 ${order.rewardCredits} credits；余额 ${next.credits} credits。`
          : "交付命令已提交，请核对订单与余额。";
      });
    },
    [csrfToken, runCommand]
  );

  const handlePurchase = useCallback(
    (itemId: string, quantity: number) => {
      if (csrfToken === null) return;
      void runCommand(
        () => createPurchase({ itemId, quantity, commandId: newCommandId() }, csrfToken),
        "economy",
        (result, next) => {
          const purchase = next.purchases.find((item) => item.purchaseId === result.purchaseId);
          return purchase
            ? `${purchase.itemName} ×${purchase.quantity} ${result.duplicate ? "采购记录已存在，原付款" : "已付款"} ${purchase.costCredits} credits，${purchase.status === "in_transit" ? `材料在途，预计基地时间 ${purchase.arrivesAtSim.slice(11, 16)} 到货` : "已入库"}。`
            : "采购命令已提交，等待采购记录出现在基地状态中。";
        }
      );
    },
    [csrfToken, runCommand]
  );

  const handleCooperationDecision = useCallback(
    (requestId: string, action: "support" | "wait", expectedHelperOperatorId?: string) => {
      if (csrfToken === null) return;
      void runCommand(() => decideCooperation(requestId, {
        action, commandId: newCommandId(),
        ...(expectedHelperOperatorId ? { expectedHelperOperatorId } : {})
      }, csrfToken), "cooperation", (result, next) => {
        if (result.status === "declined") return "已选择等待本组充电；工程会按真实可出工状态继续。";
        const helper = next.devices.find((device) => device.operatorId === result.helperOperatorId);
        return `已批准${helper?.name ?? "候选机器人"}跨组支援；请观察工程进度与设备电量。`;
      });
    },
    [csrfToken, runCommand]
  );

  const handleAcquireControl = useCallback(() => {
    if (csrfToken === null) return;
    void acquireControl(csrfToken, true).then(() => {
      void refreshSnapshot();
    }).catch((error) => setActionFeedback({ area: "clock", kind: "error", message: describeError(error) }));
  }, [csrfToken, acquireControl, refreshSnapshot]);

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
        {snapshotError ? (
          <div className="base-panel base-auth-panel">
            <h1 id="base-load-error">基地连接失败</h1>
            <p role="alert" className="base-error">
              {snapshotError}
            </p>
            <p className="base-copy">服务可能暂时不可用；你的会话仍然保留。</p>
            <button
              type="button"
              className="base-primary-button"
              onClick={() => {
                setSnapshotError(null);
                void refreshSnapshot();
              }}
            >
              重试连接
            </button>
          </div>
        ) : (
          <p className="base-copy">正在连接基地…</p>
        )}
      </main>
    );
  }

  // 新手引导：首次进入（还没有任何项目）时显示剧情弹窗；开工后不再打扰。
  // 关闭标记按基地（baseId）隔离——同一个浏览器换账号/换基地仍会看到引导（UX-02）。
  const introDismissedForBase =
    snapshot !== null &&
    globalThis.localStorage?.getItem(`base-intro-dismissed:${snapshot.baseId}`) === "1";
  const showIntro =
    snapshot !== null && snapshot.projects.length === 0 && !introDismissed && !introDismissedForBase;

  // 每个工程步骤的作业机组数（来自设备当前任务投影）——施工可读性（评审 D001）
  const crewByStep: Record<string, number> = {};
  for (const device of snapshot?.devices ?? []) {
    if (device.currentAssignment) {
      const key = `${device.currentAssignment.projectId}:${device.currentAssignment.stepIndex}`;
      crewByStep[key] = (crewByStep[key] ?? 0) + 1;
    }
  }
  return (
    <>
      {showIntro ? (
        <BaseIntroModal
          baseName={snapshot.name}
          credits={snapshot.credits}
          onDismiss={() => {
            setIntroDismissed(true);
            if (snapshot !== null) {
              globalThis.localStorage?.setItem(`base-intro-dismissed:${snapshot.baseId}`, "1");
            }
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
      {snapshotError ? (
        <p role="alert" className="base-error base-action-error">
          基地状态刷新失败：{snapshotError}（将自动重试）
        </p>
      ) : null}
      <BaseShell
        key={snapshot.baseId}
        snapshot={snapshot}
        hasControl={controlToken !== null}
        actionFeedback={actionFeedback}
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
        onAcquireControl={handleAcquireControl}
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
        onCooperationDecision={handleCooperationDecision}
        accountEmail={accountEmail}
        crewByStep={crewByStep}
        onLogout={() => void handleLogout()}
        isBusy={isActionBusy}
      />
    </>
  );
}
