// 重开基地（删档重开）入口：账户区的安静入口按钮 + 两步确认对话框。
// 第一步列清后果（当前基地全部进度/资源/工程/机器人永久删除、账号与登录保留、
// 从落地第一天重新开始），第二步才出现明确的「确认重开」按钮；确认前绝不触发删除。
// commandId 在首次点「确认重开」时生成，失败重试复用同一 id——网络丢包时重放命中的
// 是服务端收据结果，不会删两次档。
import { useRef, useState } from "react";
import { newCommandId } from "../../lib/uuid.js";

type ResetStep = "closed" | "consequences" | "confirm";

export function BaseResetControl({
  onReset,
  disabled = false,
  variant = "base"
}: {
  onReset: (commandId: string) => Promise<void>;
  disabled?: boolean;
  variant?: "base" | "landing";
}) {
  const [step, setStep] = useState<ResetStep>("closed");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 对话框一次打开期间复用同一命令 id：重试不换 id，避免“首求已成功但响应丢失”时二次删档。
  const commandIdRef = useRef<string | null>(null);

  const close = () => {
    if (isBusy) return;
    setStep("closed");
    setError(null);
    commandIdRef.current = null;
  };

  const handleConfirm = async () => {
    if (isBusy) return;
    if (commandIdRef.current === null) commandIdRef.current = newCommandId();
    const commandId = commandIdRef.current;
    setIsBusy(true);
    setError(null);
    try {
      await onReset(commandId);
      setStep("closed");
      setError(null);
      commandIdRef.current = null;
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "重开没有成功，请稍后再试。");
    } finally {
      setIsBusy(false);
    }
  };

  const triggerClass = variant === "landing" ? "landing-chip-button" : "base-logout-button";

  return (
    <>
      <button
        type="button"
        className={triggerClass}
        disabled={disabled || isBusy}
        onClick={() => setStep("consequences")}
      >
        重开基地
      </button>
      {step === "closed" ? null : (
        <div className="base-reset-backdrop" role="presentation">
          <section
            className="base-reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="重开基地"
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
            }}
          >
            {step === "consequences" ? (
              <>
                <h2 className="base-reset-title">重开基地？</h2>
                <p className="base-reset-copy">重开意味着一切从头开始，请先看清楚会发生什么：</p>
                <ul className="base-reset-list">
                  <li>当前基地的全部进度、资源、工程和机器人都会被永久删除，无法恢复。</li>
                  <li>账号和登录状态保留，不需要重新登录。</li>
                  <li>确认后立刻从落地第一天重新开始。</li>
                </ul>
                <div className="base-reset-actions">
                  <button type="button" className="base-secondary-button" onClick={close}>
                    先不重开
                  </button>
                  <button
                    type="button"
                    className="base-primary-button"
                    autoFocus
                    onClick={() => setStep("confirm")}
                  >
                    继续
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="base-reset-title">最后确认</h2>
                <p className="base-reset-copy">
                  真的要删除当前基地、回到落地第一天吗？这一步操作无法撤销。
                </p>
                {error ? (
                  <p role="alert" className="base-error">
                    {error}
                  </p>
                ) : null}
                <div className="base-reset-actions">
                  <button type="button" className="base-secondary-button" onClick={close} disabled={isBusy}>
                    返回
                  </button>
                  <button
                    type="button"
                    className="base-danger-button"
                    disabled={isBusy}
                    onClick={() => void handleConfirm()}
                  >
                    {isBusy ? "正在重开…" : "确认重开"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
