import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivationCodeAdmin } from "./ActivationCodeAdmin";

describe("ActivationCodeAdmin", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders activation-code creation and revoke controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          activationCodes: [
            {
              id: "code-1",
              status: "unused",
              note: "friend invite",
              usedByAccountId: null,
              expiresAt: null,
              createdAt: "2026-07-01T00:00:00.000Z",
              usedAt: null,
              revokedAt: null
            }
          ]
        })
      }))
    );

    render(<ActivationCodeAdmin csrfToken="csrf-token" />);

    expect(screen.getByRole("heading", { name: "激活码管理" })).toBeTruthy();
    expect(screen.getByLabelText("备注")).toBeTruthy();
    expect(screen.getByLabelText("作废原因")).toBeTruthy();
    expect(screen.getByRole("button", { name: "生成一次性激活码" })).toBeTruthy();
    expect(await screen.findByText("code-1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "作废" })).toBeTruthy();
  });

  it("creates an activation code with the admin CSRF token", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/admin/activation-codes") && fetchMock.mock.calls.length === 1) {
        return {
          ok: true,
          json: async () => ({ activationCodes: [] })
        };
      }
      return {
        ok: true,
        json: async () => ({
          code: "MUD-7K3M-9Q2P-6R8T",
          activationCode: {
            id: "code-1",
            status: "unused",
            note: "friend invite",
            usedByAccountId: null,
            expiresAt: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            usedAt: null,
            revokedAt: null
          }
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ActivationCodeAdmin csrfToken="csrf-token" />);

    fireEvent.change(screen.getByLabelText("备注"), {
      target: { value: "friend invite" }
    });
    fireEvent.click(screen.getByRole("button", { name: "生成一次性激活码" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/admin/activation-codes",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": "csrf-token"
          },
          body: JSON.stringify({ note: "friend invite" })
        })
      );
    });
    expect((await screen.findByLabelText("新激活码")).textContent).toBe("MUD-7K3M-9Q2P-6R8T");
  });

  it("revokes an unused activation code with an audited reason", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/admin/activation-codes")) {
        return {
          ok: true,
          json: async () => ({
            activationCodes: [
              {
                id: "code-1",
                status: "unused",
                note: "friend invite",
                usedByAccountId: null,
                expiresAt: null,
                createdAt: "2026-07-01T00:00:00.000Z",
                usedAt: null,
                revokedAt: null
              }
            ]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ activationCodeId: "code-1", status: "revoked" })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ActivationCodeAdmin csrfToken="csrf-token" />);

    const revokeButton = await screen.findByRole("button", { name: "作废" });
    fireEvent.change(screen.getByLabelText("作废原因"), {
      target: { value: "内测名额回收" }
    });
    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/admin/activation-codes/code-1/revoke",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": "csrf-token"
          },
          body: JSON.stringify({ reason: "内测名额回收" })
        })
      );
    });
    expect(await screen.findByText("激活码已作废")).toBeTruthy();
  });
});
