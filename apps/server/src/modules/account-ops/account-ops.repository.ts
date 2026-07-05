import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { accounts, sessions } from "../../db/schema.js";
import type { AccountOpsRepositoryPort, AdminAccountRecord } from "./account-ops.service.js";

type AccountOpsDb = Pick<Db, "select" | "update">;

export class AccountOpsRepository implements AccountOpsRepositoryPort {
  constructor(private readonly db: AccountOpsDb) {}

  async listAccounts(): Promise<AdminAccountRecord[]> {
    return this.db
      .select({
        id: accounts.id,
        email: accounts.email,
        role: accounts.role,
        status: accounts.status,
        createdAt: accounts.createdAt,
        lastLoginAt: accounts.lastLoginAt
      })
      .from(accounts)
      .orderBy(desc(accounts.createdAt));
  }

  async findAccountById(accountId: string): Promise<AdminAccountRecord | null> {
    const [account] = await this.db
      .select({
        id: accounts.id,
        email: accounts.email,
        role: accounts.role,
        status: accounts.status,
        createdAt: accounts.createdAt,
        lastLoginAt: accounts.lastLoginAt
      })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);

    return account ?? null;
  }

  async disableAccount(accountId: string): Promise<AdminAccountRecord | null> {
    const [account] = await this.db
      .update(accounts)
      .set({ status: "disabled" })
      .where(and(eq(accounts.id, accountId), eq(accounts.status, "active")))
      .returning({
        id: accounts.id,
        email: accounts.email,
        role: accounts.role,
        status: accounts.status,
        createdAt: accounts.createdAt,
        lastLoginAt: accounts.lastLoginAt
      });

    return account ?? null;
  }

  async restoreAccount(accountId: string): Promise<AdminAccountRecord | null> {
    const [account] = await this.db
      .update(accounts)
      .set({ status: "active" })
      .where(and(eq(accounts.id, accountId), eq(accounts.status, "disabled")))
      .returning({
        id: accounts.id,
        email: accounts.email,
        role: accounts.role,
        status: accounts.status,
        createdAt: accounts.createdAt,
        lastLoginAt: accounts.lastLoginAt
      });

    return account ?? null;
  }

  async revokeActiveSessions(accountId: string): Promise<number> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });

    return rows.length;
  }
}
