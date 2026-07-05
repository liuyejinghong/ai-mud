import type { AccountRecord } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";

export interface AdminBootstrapRepository {
  findAccountByEmail(email: string): Promise<AccountRecord | null>;
  createAccount(input: {
    email: string;
    passwordHash: string;
    role: "admin";
  }): Promise<AccountRecord>;
}

export class AdminBootstrapService {
  constructor(
    private readonly options: {
      repository: AdminBootstrapRepository;
      auth: AuthService;
    }
  ) {}

  async ensure(input: {
    email: string | undefined;
    password: string | undefined;
  }): Promise<{ created: boolean; accountId: string | null }> {
    if (!input.email || !input.password) {
      return { created: false, accountId: null };
    }

    const existing = await this.options.repository.findAccountByEmail(input.email);
    if (existing) {
      return { created: false, accountId: existing.id };
    }

    const passwordHash = await this.options.auth.hashPassword(input.password);
    const account = await this.options.repository.createAccount({
      email: input.email,
      passwordHash,
      role: "admin"
    });

    return { created: true, accountId: account.id };
  }
}
