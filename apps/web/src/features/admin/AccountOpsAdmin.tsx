import { useEffect, useState } from "react";
import type { AdminAccountDto } from "@ai-mud/shared";
import {
  disableAdminAccount,
  getAdminAccounts,
  restoreAdminAccount,
  revokeAdminAccountSessions
} from "./adminApi";
import "./ActivationCodeAdmin.css";

export function AccountOpsAdmin({ csrfToken }: { csrfToken: string }) {
  const [accounts, setAccounts] = useState<AdminAccountDto[]>([]);
  const [reason, setReason] = useState("内测运营处理");
  const [message, setMessage] = useState("");
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getAdminAccounts()
      .then((result) => {
        if (!cancelled) setAccounts(result.accounts);
      })
      .catch(() => {
        if (!cancelled) setMessage("账号列表加载失败");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function runAccountOperation(
    accountId: string,
    operation: "disable" | "restore" | "revoke-sessions"
  ) {
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 4) {
      setMessage("请填写至少 4 个字的运营原因");
      return;
    }

    setBusyAccountId(accountId);
    setMessage("");

    try {
      if (operation === "disable") {
        const result = await disableAdminAccount(accountId, trimmedReason, csrfToken);
        setAccounts((current) =>
          current.map((account) => (account.id === accountId ? result.account : account))
        );
        setMessage(`账号已禁用，已踢下线 ${result.revokedSessionCount} 个会话`);
      } else if (operation === "restore") {
        const result = await restoreAdminAccount(accountId, trimmedReason, csrfToken);
        setAccounts((current) =>
          current.map((account) => (account.id === accountId ? result.account : account))
        );
        setMessage("账号已恢复");
      } else {
        const result = await revokeAdminAccountSessions(accountId, trimmedReason, csrfToken);
        setMessage(`已踢下线 ${result.revokedSessionCount} 个会话`);
      }
    } catch {
      setMessage("账号操作失败");
    } finally {
      setBusyAccountId(null);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="account-ops-admin-title">
      <div className="admin-panel-header">
        <h2 id="account-ops-admin-title">账号运营</h2>
        <span>Closed Beta Ops</span>
      </div>

      <div className="account-ops-body">
        <label className="admin-field" htmlFor="account-ops-reason">
          运营原因
          <input
            id="account-ops-reason"
            value={reason}
            maxLength={240}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        <div className="admin-table" role="table" aria-label="账号列表">
          <div className="admin-table-row admin-table-heading account-ops-table-row" role="row">
            <span role="columnheader">邮箱</span>
            <span role="columnheader">角色</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">最近登录</span>
            <span role="columnheader">操作</span>
          </div>
          {accounts.map((account) => (
            <div className="admin-table-row account-ops-table-row" role="row" key={account.id}>
              <span role="cell">{account.email}</span>
              <span role="cell">{account.role}</span>
              <span role="cell" data-status={account.status}>
                {account.status}
              </span>
              <span role="cell">{account.lastLoginAt ?? "从未登录"}</span>
              <span role="cell" className="account-ops-actions">
                {account.status === "active" ? (
                  <button
                    type="button"
                    disabled={busyAccountId === account.id}
                    onClick={() => void runAccountOperation(account.id, "disable")}
                  >
                    禁用
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyAccountId === account.id}
                    onClick={() => void runAccountOperation(account.id, "restore")}
                  >
                    恢复
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyAccountId === account.id}
                  onClick={() => void runAccountOperation(account.id, "revoke-sessions")}
                >
                  踢下线
                </button>
              </span>
            </div>
          ))}
        </div>

        <p role="status" aria-live="polite" className="admin-status">
          {message}
        </p>
      </div>
    </section>
  );
}
