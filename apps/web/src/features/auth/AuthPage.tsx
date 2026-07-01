import type { FormEvent } from "react";
import { useState } from "react";
import { login, registerAccount, type AuthSessionDto } from "./authApi";
import "./AuthPage.css";

export function AuthPage({ onAuthenticated }: { onAuthenticated?: (session: AuthSessionDto) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function switchMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setMessage("");
  }

  async function submitLogin() {
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await login({ email, password });
      if (!response.ok) {
        setMessage("登录失败，请检查邮箱或密码。");
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

    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await registerAccount({ email, password, activationCode });
      if (!response.ok) {
        setMessage("注册失败，请检查邮箱、密码和激活码。");
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "login") {
      void submitLogin();
      return;
    }
    void submitRegister();
  }

  return (
    <main className="auth-page">
      <section className="auth-shell" aria-label="内测认证入口">
        <header className="auth-header">
          <h1 className="auth-title">AI MUD 内测登录</h1>
          <span className="auth-version">v0.1 Foundation</span>
        </header>

        <div className="auth-body">
          <aside className="auth-briefing">
            <p>服务器状态：封闭内测。</p>
            <p>黑松哨站的通行名册，只向持有码的冒险者开放。</p>
            <p>你的名字会被写入城镇账本，随后才允许进入边境。</p>
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
                {mode === "login" ? "登录" : "创建账号"}
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
