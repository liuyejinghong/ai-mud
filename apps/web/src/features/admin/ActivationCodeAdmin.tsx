import { useEffect, useState } from "react";
import type { ActivationCodeDto } from "@ai-mud/shared";
import { createActivationCode, getActivationCodes, revokeActivationCode } from "./adminApi";
import "./ActivationCodeAdmin.css";

export function ActivationCodeAdmin({ csrfToken }: { csrfToken: string }) {
  const [note, setNote] = useState("");
  const [revokeReason, setRevokeReason] = useState("内测名额回收");
  const [activationCodes, setActivationCodes] = useState<ActivationCodeDto[]>([]);
  const [createdCode, setCreatedCode] = useState("");
  const [message, setMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [revokingCodeId, setRevokingCodeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getActivationCodes()
      .then((result) => {
        if (!cancelled) setActivationCodes(result.activationCodes);
      })
      .catch(() => {
        if (!cancelled) setMessage("激活码列表加载失败");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate() {
    setIsCreating(true);
    setMessage("");
    setCreatedCode("");

    try {
      const result = await createActivationCode(note, csrfToken);
      setCreatedCode(result.code);
      setActivationCodes((current) => [result.activationCode, ...current]);
      setMessage("激活码已生成");
    } catch {
      setMessage("生成失败");
    } finally {
      setIsCreating(false);
    }
  }

  async function onRevoke(activationCodeId: string) {
    const trimmedReason = revokeReason.trim();
    if (trimmedReason.length < 4) {
      setMessage("请填写至少 4 个字的作废原因");
      return;
    }

    setRevokingCodeId(activationCodeId);
    setMessage("");

    try {
      await revokeActivationCode(activationCodeId, trimmedReason, csrfToken);
      setActivationCodes((current) =>
        current.map((activationCode) =>
          activationCode.id === activationCodeId
            ? { ...activationCode, status: "revoked", revokedAt: new Date().toISOString() }
            : activationCode
        )
      );
      setMessage("激活码已作废");
    } catch {
      setMessage("作废失败");
    } finally {
      setRevokingCodeId(null);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="activation-code-admin-title">
      <div className="admin-panel-header">
        <h2 id="activation-code-admin-title">激活码管理</h2>
        <span>Admin Console</span>
      </div>

      <div className="activation-code-admin-body">
        <label className="admin-field" htmlFor="activation-code-note">
          备注
          <input
            id="activation-code-note"
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <div className="admin-panel-body">
          <label className="admin-field" htmlFor="activation-code-revoke-reason">
            作废原因
            <input
              id="activation-code-revoke-reason"
              value={revokeReason}
              maxLength={240}
              onChange={(event) => setRevokeReason(event.target.value)}
            />
          </label>

          <button type="button" disabled={isCreating} onClick={() => void onCreate()}>
            生成一次性激活码
          </button>
        </div>

        <p role="status" aria-live="polite" className="admin-status">
          {message}
        </p>

        {createdCode ? (
          <output className="activation-code-output" aria-label="新激活码">
            {createdCode}
          </output>
        ) : null}

        <div className="admin-table" role="table" aria-label="激活码列表">
          <div className="admin-table-row admin-table-heading activation-code-table-row" role="row">
            <span role="columnheader">激活码 ID</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">备注</span>
            <span role="columnheader">创建时间</span>
            <span role="columnheader">操作</span>
          </div>
          {activationCodes.map((activationCode) => (
            <div
              className="admin-table-row activation-code-table-row"
              role="row"
              key={activationCode.id}
            >
              <span role="cell">{activationCode.id}</span>
              <span role="cell" data-status={activationCode.status}>
                {activationCode.status}
              </span>
              <span role="cell">{activationCode.note ?? "无备注"}</span>
              <span role="cell">{activationCode.createdAt}</span>
              <span role="cell" className="activation-code-actions">
                <button
                  type="button"
                  disabled={activationCode.status !== "unused" || revokingCodeId === activationCode.id}
                  onClick={() => void onRevoke(activationCode.id)}
                >
                  作废
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
