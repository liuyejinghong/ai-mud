import { describe, expect, it } from "vitest";
import { AuthService } from "./auth.service.js";

describe("AuthService", () => {
  it("hashes passwords and verifies correct passwords only", async () => {
    const service = new AuthService();
    const hash = await service.hashPassword("correct horse battery staple");

    expect(hash).not.toBe("correct horse battery staple");
    await expect(service.verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(service.verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("creates opaque session tokens and stores only hashes", () => {
    const service = new AuthService();
    const session = service.createSessionToken();

    expect(session.token.length).toBeGreaterThan(32);
    expect(session.tokenHash).not.toBe(session.token);
    expect(session.tokenHash).toHaveLength(64);
  });

  it("derives verifiable csrf tokens from the session token", () => {
    const service = new AuthService();
    const csrf = service.createCsrfToken("session-token", "secret-that-is-long-enough");

    expect(service.verifyCsrfToken("session-token", "secret-that-is-long-enough", csrf)).toBe(true);
    expect(service.verifyCsrfToken("other-session", "secret-that-is-long-enough", csrf)).toBe(false);
  });
});
