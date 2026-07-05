import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountOpsAdmin } from "./AccountOpsAdmin";

const account = {
  id: "account-1",
  email: "player@example.com",
  role: "player",
  status: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
  lastLoginAt: null
};

describe("AccountOpsAdmin", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders closed-beta account operations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ accounts: [account] })
      }))
    );

    render(<AccountOpsAdmin csrfToken="csrf-token" />);

    expect(screen.getByRole("heading", { name: "账号运营" })).toBeTruthy();
    expect(screen.getByLabelText("运营原因")).toBeTruthy();
    expect(await screen.findByText("player@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "禁用" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "踢下线" })).toBeTruthy();
  });

  it("disables an account with an audited reason and admin CSRF token", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/admin/accounts")) {
        return {
          ok: true,
          json: async () => ({ accounts: [account] })
        };
      }
      return {
        ok: true,
        json: async () => ({
          account: { ...account, status: "disabled" },
          revokedSessionCount: 2
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountOpsAdmin csrfToken="csrf-token" />);

    const disableButton = await screen.findByRole("button", { name: "禁用" });
    fireEvent.change(screen.getByLabelText("运营原因"), {
      target: { value: "内测违规处理" }
    });
    fireEvent.click(disableButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/admin/accounts/account-1/disable",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": "csrf-token"
          },
          body: JSON.stringify({ reason: "内测违规处理" })
        })
      );
    });
    expect(await screen.findByText("账号已禁用，已踢下线 2 个会话")).toBeTruthy();
  });

  it("revokes account sessions without changing account status", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/admin/accounts")) {
        return {
          ok: true,
          json: async () => ({ accounts: [account] })
        };
      }
      return {
        ok: true,
        json: async () => ({ accountId: "account-1", revokedSessionCount: 3 })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountOpsAdmin csrfToken="csrf-token" />);

    const revokeButton = await screen.findByRole("button", { name: "踢下线" });
    fireEvent.change(screen.getByLabelText("运营原因"), {
      target: { value: "强制重新登录" }
    });
    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/admin/accounts/account-1/revoke-sessions",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": "csrf-token"
          },
          body: JSON.stringify({ reason: "强制重新登录" })
        })
      );
    });
    expect(await screen.findByText("已踢下线 3 个会话")).toBeTruthy();
  });
});
