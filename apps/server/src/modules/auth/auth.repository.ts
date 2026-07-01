import type { AccountRole, AccountStatus } from "@ai-mud/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { accounts, sessions } from "../../db/schema.js";

type AuthDb = Pick<Db, "insert" | "select" | "update">;

export interface AccountRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: AccountRole;
  status: AccountStatus;
}

export type PublicAccountRecord = Omit<AccountRecord, "passwordHash">;

export class AuthRepository {
  constructor(private readonly db: AuthDb) {}

  async createAccount(input: { email: string; passwordHash: string; role?: AccountRole }): Promise<AccountRecord> {
    const [account] = await this.db
      .insert(accounts)
      .values({
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role ?? "player"
      })
      .returning({
        id: accounts.id,
        email: accounts.email,
        passwordHash: accounts.passwordHash,
        role: accounts.role,
        status: accounts.status
      });

    if (!account) throw new Error("Failed to create account");
    return account;
  }

  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    const [account] = await this.db
      .select({
        id: accounts.id,
        email: accounts.email,
        passwordHash: accounts.passwordHash,
        role: accounts.role,
        status: accounts.status
      })
      .from(accounts)
      .where(eq(accounts.email, email.toLowerCase()))
      .limit(1);

    return account ?? null;
  }

  async findAccountById(id: string): Promise<PublicAccountRecord | null> {
    const [account] = await this.db
      .select({
        id: accounts.id,
        email: accounts.email,
        role: accounts.role,
        status: accounts.status
      })
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);

    return account ?? null;
  }

  async createSession(input: { accountId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await this.db.insert(sessions).values(input);
  }

  async findAccountBySessionTokenHash(tokenHash: string): Promise<PublicAccountRecord | null> {
    const [row] = await this.db
      .select({
        accountId: accounts.id,
        email: accounts.email,
        role: accounts.role,
        status: accounts.status,
        expiresAt: sessions.expiresAt
      })
      .from(sessions)
      .innerJoin(accounts, eq(accounts.id, sessions.accountId))
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
      .limit(1);

    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    return {
      id: row.accountId,
      email: row.email,
      role: row.role,
      status: row.status
    };
  }

  async revokeSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));
  }
}
