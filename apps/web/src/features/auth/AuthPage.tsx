import type { FormEvent } from "react";
import { useState } from "react";
import type { ApiErrorBody, ErrorCode } from "@ai-mud/shared";
import { playtestRegister } from "../base/baseApi";
import { login, registerAccount, type AuthSessionDto } from "./authApi";
import "./AuthPage.css";

const PASSWORD_MIN_LENGTH = 12;

function normalizeActivationCode(value: string) {
  return value.trim().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, "");
}

async function readAuthError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    const code = body.error?.code;
    if (code) return authErrorMessage(code, fallback);
  } catch {
    // Keep the user-facing fallback below when the server does not return JSON.
  }

  return fallback;
}

function authErrorMessage(code: ErrorCode, fallback: string) {
  const messages: Partial<Record<ErrorCode, string>> = {
    VALIDATION_ERROR: "邮箱格式不正确，或密码少于 12 个字符。",
    ACTIVATION_CODE_INVALID: "激活码无效，请检查字符和横线。",
    ACTIVATION_CODE_USED: "这个激活码已经被使用。",
    ACTIVATION_CODE_EXPIRED: "这个激活码已经过期。",
    UNAUTHENTICATED: "登录失败，请检查邮箱或密码。",
    ACCOUNT_DISABLED: "账号已被停用。"
  };

  return messages[code] ?? fallback;
}

export function AuthPage({ onAuthenticated }: { onAuthenticated?: (session: AuthSessionDto) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "playtest">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function switchMode(nextMode: "login" | "register" | "playtest") {
    setMode(nextMode);
    setMessage("");
  }

  async function submitLogin() {
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await login({ email, password });
      if (!response.ok) {
        setMessage(await readAuthError(response, "登录失败，请检查邮箱或密码。"));
        return;
      }

      const session = (await response.json()) as AuthSessionDto;
      onAuthenticated?.(session);
      setMessage("登录成功，正在进入世界。");
    } catch {
      setMessage("无法连接服务器。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitRegister() {
    if (password !== confirmPassword) {
      setMessage("两次输入的密码不一致。");
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setMessage(`密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符。`);
      return;
    }

    const normalizedCode = normalizeActivationCode(activationCode);
    if (!normalizedCode) {
      setMessage("请输入激活码。");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await registerAccount({
        email: email.trim(),
        password,
        activationCode: normalizedCode
      });
      if (!response.ok) {
        setMessage(await readAuthError(response, "注册失败，请检查邮箱、密码和激活码。"));
        return;
      }

      setActivationCode("");
      setConfirmPassword("");
      setMode("login");
      setMessage("注册成功，请使用邮箱和密码登录。");
    } catch {
      setMessage("无法连接服务器。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitPlaytestRegister() {
    if (password.length < 1) {
      setMessage("请输入密码（试玩模式允许简单密码）。");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const result = await playtestRegister({ email: email.trim(), password });
      onAuthenticated?.({
        user: { id: result.user.accountId, email: result.user.email, role: "player", status: "active" },
        csrfToken: result.csrfToken
      });
      setMessage("注册成功，正在进入基地。");
    } catch {
      setMessage("无法连接服务器，或试玩注册未开放。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "login") {
      void submitLogin();
      return;
    }
    if (mode === "playtest") {
      void submitPlaytestRegister();
      return;
    }
    void submitRegister();
  }

  return (
    <main className="auth-page">
      <section className="auth-shell" aria-label="内测认证入口">
        <header className="auth-header">
          <h1 className="auth-title">AI MUD 内测登录</h1>
          <span className="auth-version">v0.12.0</span>
        </header>

        <div className="auth-body">
          <aside className="auth-briefing">
            {mode === "playtest" ? (
              <>
                <p>服务器状态：开发试玩。</p>
                <p>注册后自动获得一座火星先遣基地，用鼠标指挥工程队开工。</p>
                <p>试玩模式允许简单密码；正式开放策略另行验收。</p>
              </>
            ) : (
              <>
                <p>服务器状态：封闭内测。</p>
                <p>黑松哨站的通行名册，只向持有码的冒险者开放。</p>
                <p>你的名字会被写入城镇账本，随后才允许进入边境。</p>
              </>
            )}
          </aside>

          <form className="auth-form" onSubmit={onSubmit}>
            <div className="auth-mode-switch" role="tablist" aria-label="账号入口">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className="auth-tab"
                onClick={() => switchMode("login")}
              >
                登录
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className="auth-tab"
                onClick={() => switchMode("register")}
              >
                注册
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "playtest"}
                className="auth-tab"
                onClick={() => switchMode("playtest")}
              >
                试玩注册
              </button>
            </div>

            <label className="auth-field" htmlFor="auth-email">
              邮箱
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="auth-field" htmlFor="auth-password">
              密码
              <input
                id="auth-password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={mode === "register" ? PASSWORD_MIN_LENGTH : mode === "playtest" ? 1 : undefined}
              />
            </label>

            {mode === "register" ? (
              <>
                <label className="auth-field" htmlFor="confirm-password">
                  确认密码
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={PASSWORD_MIN_LENGTH}
                  />
                </label>

                <label className="auth-field" htmlFor="activation-code">
                  激活码
                  <input
                    id="activation-code"
                    autoComplete="one-time-code"
                    value={activationCode}
                    onChange={(event) => setActivationCode(event.target.value)}
                  />
                </label>
              </>
            ) : null}

            <div className="auth-actions">
              <button
                type="submit"
                className="auth-primary-button"
                disabled={isSubmitting}
              >
                {mode === "login" ? "登录" : mode === "playtest" ? "注册并进入基地" : "创建账号"}
              </button>
            </div>

            <p role="status" aria-live="polite" className="auth-status">
              {message}
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
