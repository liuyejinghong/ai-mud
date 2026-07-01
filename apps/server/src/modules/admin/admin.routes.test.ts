import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAdminRoutes, type AdminRouteDependencies } from "./admin.routes.js";

function buildAdminRouteTestApp(deps: AdminRouteDependencies) {
  const app = Fastify();
  void registerAdminRoutes(app, deps);
  return app;
}

describe("registerAdminRoutes", () => {
  it("rejects activation-code creation without an admin session", async () => {
    const createCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null,
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async (input) => {
        createCalls.push(input);
        return {
          code: "SHOULD-NOT-CREATE",
          activationCode: {
            id: "code-1",
            status: "unused",
            note: null,
            usedByAccountId: null,
            expiresAt: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            usedAt: null,
            revokedAt: null
          }
        };
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      payload: { note: "friend invite" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
    expect(createCalls).toEqual([]);
  });

  it("creates an activation code for admins through one atomic audited operation", async () => {
    const createCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async (input) => {
        createCalls.push(input);
        return {
          code: "INVITE-CODE-123",
          activationCode: {
            id: "code-1",
            status: "unused",
            note: "friend invite",
            usedByAccountId: null,
            expiresAt: "2026-07-08T00:00:00.000Z",
            createdAt: "2026-07-01T00:00:00.000Z",
            usedAt: null,
            revokedAt: null
          }
        };
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      payload: {
        note: "friend invite",
        expiresAt: "2026-07-08T00:00:00.000Z"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      code: "INVITE-CODE-123",
      activationCode: {
        id: "code-1",
        status: "unused",
        note: "friend invite",
        usedByAccountId: null,
        expiresAt: "2026-07-08T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
        usedAt: null,
        revokedAt: null
      }
    });
    expect(createCalls).toEqual([
      {
        note: "friend invite",
        createdByAdminId: "admin-1",
        expiresAt: new Date("2026-07-08T00:00:00.000Z"),
        metadata: { expiresAt: "2026-07-08T00:00:00.000Z" }
      }
    ]);
  });

  it("does not return a generated code if the atomic audited operation fails", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async () => {
        throw new Error("audit insert failed");
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      payload: { note: "friend invite" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("INVITE-CODE");
  });
});
