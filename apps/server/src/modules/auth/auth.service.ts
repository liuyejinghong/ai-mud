import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

export class AuthService {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }

  createSessionToken() {
    const token = randomBytes(32).toString("base64url");
    return {
      token,
      tokenHash: this.hashToken(token)
    };
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  createCsrfToken(sessionToken: string, secret: string): string {
    return createHmac("sha256", secret).update(sessionToken).digest("base64url");
  }

  verifyCsrfToken(sessionToken: string, secret: string, csrfToken: string): boolean {
    const expected = this.createCsrfToken(sessionToken, secret);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(csrfToken);

    if (expectedBuffer.byteLength !== actualBuffer.byteLength) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
