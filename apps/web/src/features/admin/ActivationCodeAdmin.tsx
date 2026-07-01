import { useState } from "react";
import { createActivationCode } from "./adminApi";
import "./ActivationCodeAdmin.css";

export function ActivationCodeAdmin() {
  const [note, setNote] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  const [message, setMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  async function onCreate() {
    setIsCreating(true);
    setMessage("");
    setCreatedCode("");

    try {
      const result = await createActivationCode(note);
      setCreatedCode(result.code);
      setMessage("激活码已生成");
    } catch {
      setMessage("生成失败");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="activation-code-admin-title">
      <div className="admin-panel-header">
        <h2 id="activation-code-admin-title">激活码管理</h2>
        <span>Admin Console</span>
      </div>

      <div className="admin-panel-body">
        <label className="admin-field" htmlFor="activation-code-note">
          备注
          <input
            id="activation-code-note"
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <button type="button" disabled={isCreating} onClick={() => void onCreate()}>
          生成一次性激活码
        </button>

        <p role="status" aria-live="polite" className="admin-status">
          {message}
        </p>

        {createdCode ? (
          <output className="activation-code-output" aria-label="新激活码">
            {createdCode}
          </output>
        ) : null}
      </div>
    </section>
  );
}
