import type {
  AccountOperationResponseDto,
  AdminAccountDto,
  RevokeSessionsResponseDto
} from "@ai-mud/shared";
import type { AuditWriter } from "../audit/audit.service.js";

export interface AdminAccountRecord {
  id: string;
  email: string;
  role: AdminAccountDto["role"];
  status: AdminAccountDto["status"];
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface AccountOpsRepositoryPort {
  listAccounts(): Promise<AdminAccountRecord[]>;
  findAccountById(accountId: string): Promise<AdminAccountRecord | null>;
  disableAccount(accountId: string): Promise<AdminAccountRecord | null>;
  restoreAccount(accountId: string): Promise<AdminAccountRecord | null>;
  revokeActiveSessions(accountId: string): Promise<number>;
}

export class AccountOpsServiceError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR",
    message: string
  ) {
    super(message);
  }
}

export class AccountOpsService {
  constructor(
    private readonly options: {
      repository: AccountOpsRepositoryPort;
      audit: AuditWriter;
    }
  ) {}

  async listAccounts(): Promise<AdminAccountDto[]> {
    const accounts = await this.options.repository.listAccounts();
    return accounts.map(toAdminAccountDto);
  }

  async disableAccount(input: {
    actorAccountId: string;
    targetAccountId: string;
    reason: string;
  }): Promise<AccountOperationResponseDto> {
    if (input.actorAccountId === input.targetAccountId) {
      throw new AccountOpsServiceError("VALIDATION_ERROR", "不能禁用当前管理员账号。");
    }

    const account = await this.options.repository.disableAccount(input.targetAccountId);
    if (!account) {
      throw new AccountOpsServiceError("VALIDATION_ERROR", "账号不存在或已被禁用。");
    }
    const revokedSessionCount = await this.options.repository.revokeActiveSessions(
      input.targetAccountId
    );
    await this.options.audit.write({
      actorAccountId: input.actorAccountId,
      action: "account.disable",
      targetType: "account",
      targetId: input.targetAccountId,
      reason: input.reason,
      metadata: { revokedSessionCount }
    });

    return { account: toAdminAccountDto(account), revokedSessionCount };
  }

  async restoreAccount(input: {
    actorAccountId: string;
    targetAccountId: string;
    reason: string;
  }): Promise<AccountOperationResponseDto> {
    const account = await this.options.repository.restoreAccount(input.targetAccountId);
    if (!account) {
      throw new AccountOpsServiceError("VALIDATION_ERROR", "账号不存在或未被禁用。");
    }
    await this.options.audit.write({
      actorAccountId: input.actorAccountId,
      action: "account.restore",
      targetType: "account",
      targetId: input.targetAccountId,
      reason: input.reason,
      metadata: { revokedSessionCount: 0 }
    });

    return { account: toAdminAccountDto(account), revokedSessionCount: 0 };
  }

  async revokeSessions(input: {
    actorAccountId: string;
    targetAccountId: string;
    reason: string;
  }): Promise<RevokeSessionsResponseDto> {
    const account = await this.options.repository.findAccountById(input.targetAccountId);
    if (!account) {
      throw new AccountOpsServiceError("VALIDATION_ERROR", "账号不存在。");
    }
    const revokedSessionCount = await this.options.repository.revokeActiveSessions(
      input.targetAccountId
    );
    await this.options.audit.write({
      actorAccountId: input.actorAccountId,
      action: "account.sessions.revoke",
      targetType: "account",
      targetId: input.targetAccountId,
      reason: input.reason,
      metadata: { revokedSessionCount }
    });

    return { accountId: input.targetAccountId, revokedSessionCount };
  }
}

export function toAdminAccountDto(account: AdminAccountRecord): AdminAccountDto {
  return {
    id: account.id,
    email: account.email,
    role: account.role,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
    lastLoginAt: account.lastLoginAt?.toISOString() ?? null
  };
}
