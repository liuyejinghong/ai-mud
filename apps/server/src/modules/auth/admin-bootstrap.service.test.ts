import { describe, expect, it, vi } from "vitest";
import { AdminBootstrapService } from "./admin-bootstrap.service.js";
import { AuthService } from "./auth.service.js";

const existingAdmin = {
  id: "admin-1",
  email: "admin@example.com",
  passwordHash: "hash",
  role: "admin" as const,
  status: "active" as const
};

describe("AdminBootstrapService", () => {
  it("does nothing when bootstrap credentials are absent", async () => {
    const service = new AdminBootstrapService({
      repository: {
        findAccountByEmail: vi.fn(),
        createAccount: vi.fn()
      },
      auth: new AuthService()
    });

    await expect(service.ensure({ email: undefined, password: undefined })).resolves.toEqual({
      created: false,
      accountId: null
    });
  });

  it("does not overwrite an existing admin account", async () => {
    const createAccount = vi.fn();
    const service = new AdminBootstrapService({
      repository: {
        findAccountByEmail: vi.fn(async () => existingAdmin),
        createAccount
      },
      auth: new AuthService()
    });

    await expect(
      service.ensure({ email: "admin@example.com", password: "change-me-before-use" })
    ).resolves.toEqual({ created: false, accountId: "admin-1" });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it("creates the first admin account idempotently when no account exists", async () => {
    const createAccount = vi.fn(async (input) => ({
      ...existingAdmin,
      passwordHash: input.passwordHash
    }));
    const service = new AdminBootstrapService({
      repository: {
        findAccountByEmail: vi.fn(async () => null),
        createAccount
      },
      auth: new AuthService()
    });

    await expect(
      service.ensure({ email: "admin@example.com", password: "change-me-before-use" })
    ).resolves.toEqual({ created: true, accountId: "admin-1" });
    expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "admin@example.com",
        role: "admin"
      })
    );
    expect(createAccount.mock.calls[0]![0].passwordHash).not.toBe("change-me-before-use");
  });
});
