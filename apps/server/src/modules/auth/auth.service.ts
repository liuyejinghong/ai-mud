import { createHash, randomBytes } from "node:crypto";
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
}
