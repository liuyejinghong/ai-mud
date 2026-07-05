import { useState } from "react";
import { resetWorld } from "./adminApi";
import "./ActivationCodeAdmin.css";

const CONFIRMATION_TEXT = "RESET BLACKPINE";

export function WorldResetAdmin({ csrfToken }: { csrfToken: string }) {
  const [reason, setReason] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [message, setMessage] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const canReset = confirmationText.trim() === CONFIRMATION_TEXT && reason.trim().length >= 8;

  async function onResetWorld() {
    if (!canReset) return;

    setIsResetting(true);
    setMessage("");
    try {
      const result = await resetWorld(confirmationText, reason, csrfToken);
      setReason("");
      setConfirmationText("");
      setMessage(`世界已重置：${result.resetAt}`);
    } catch {
      setMessage("世界重置失败");
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="world-reset-admin-title">
      <div className="admin-panel-header">
        <h2 id="world-reset-admin-title">世界重置</h2>
        <span>Recovery</span>
      </div>

      <div className="admin-panel-body">
        <label className="admin-field" htmlFor="world-reset-reason">
          重置原因
          <textarea
            id="world-reset-reason"
            value={reason}
            maxLength={240}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        <label className="admin-field" htmlFor="world-reset-confirmation">
          确认短语
          <input
            id="world-reset-confirmation"
            value={confirmationText}
            placeholder={CONFIRMATION_TEXT}
            onChange={(event) => setConfirmationText(event.target.value)}
          />
        </label>

        <button
          type="button"
          disabled={isResetting || !canReset}
          onClick={() => void onResetWorld()}
        >
          重置黑松世界
        </button>

        <p role="status" aria-live="polite" className="admin-status">
          {message}
        </p>
      </div>
    </section>
  );
}
