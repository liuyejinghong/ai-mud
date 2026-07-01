import type { FormEvent } from "react";
import { useState } from "react";
import { login, registerAccount, type AuthSessionDto } from "./authApi";
import "./AuthPage.css";

export function AuthPage({ onAuthenticated }: { onAuthenticated?: (session: AuthSessionDto) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(action: "login" | "register") {
    setIsSubmitting(true);
    setMessage("");

    try {
      const response =
        action === "register"
          ? await registerAccount({ email, password, activationCode })
          : await login({ email, password });
      if (!response.ok) {
        setMessage("认证失败，请检查输入。");
        return;
      }

      const session = (await response.json()) as AuthSessionDto;
      onAuthenticated?.(session);
      setMessage("认证成功，正在进入世界。");
    } catch {
      setMessage("无法连接服务器。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
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

            <div className="auth-actions">
              <button
                type="button"
                className="auth-primary-button"
                disabled={isSubmitting}
                onClick={() => void submit("register")}
              >
                注册并进入
              </button>
              <button
                type="button"
                className="auth-secondary-button"
                disabled={isSubmitting}
                onClick={() => void submit("login")}
              >
                登录
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
