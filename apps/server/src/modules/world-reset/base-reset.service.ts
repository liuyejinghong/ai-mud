// 账号重开（删档重开）用例：一个事务内删除该账号旧基地的全部数据（FK 安全闭包）
// 并按注册同款 provision 流程重建新档（landing 内容、初始倍速、新 baseId）。
// 失败整体回滚：不允许出现"删了没建成"的中间态（旧档不丢）。
//
// 依赖注入：
//   - repo：world.base 的 BaseRepository（收据读写 + 账号→基地查找 + 行锁）；
//   - deleter：base-reset.repository（横切删除，精确登记的基础设施例外）；
//   - provisionInTx：组合根绑定 BaseService.seedProvisionedBase——开局种子装配只有
//     provisioning 一条实现路径（一事实一写者），重开不在本模块复刻种子逻辑；
//   - openAudit：与 AssetMutationService 回执同模式，审计行写入同一事务。
import { randomUUID } from "node:crypto";
import type { Db } from "../../db/client.js";
import type { AuditWriter } from "../audit/audit.service.js";
import {
  hashRequestPayload,
  type BaseRepoTx,
  type BaseRepository
} from "../world-runtime/base.repository.js";
import { BaseOperationError } from "../world-runtime/base.service.js";
import { BASE_RESET_COMMAND_KIND, type BaseResetRepository } from "./base-reset.repository.js";

export type BaseResetDb = BaseRepoTx & { transaction?: Db["transaction"] };

// 组合根绑定：注册同款 provision 的事务内主体（BaseService.seedProvisionedBase）。
export interface ProvisionInTxPort {
  (
    tx: BaseRepoTx,
    repo: BaseRepository,
    input: { accountId: string; commandId: string }
  ): Promise<{ baseId: string }>;
}

export interface BaseResetDeps {
  db: BaseResetDb;
  repo: BaseRepository;
  // 事务绑定工厂：删除必须发生在重开事务内（与 BaseEventRepository/DrizzleAuditWriter
  // 同一 `(tx) => new Repo(tx)` 绑定模式；绑死根连接会让删除游离到事务外自动提交）。
  openDeleter: (tx: BaseRepoTx) => BaseResetRepository;
  provisionInTx: ProvisionInTxPort;
  openAudit: (tx: BaseRepoTx) => AuditWriter;
}

export class BaseResetService {
  constructor(private readonly deps: BaseResetDeps) {}

  // 有 transaction 则开事务；否则（测试替身）直用当前 db——与 BaseService.transact 同口径。
  async resetBase(
    principal: { accountId: string },
    input: { commandId?: string }
  ): Promise<{ baseId: string; duplicate: boolean }> {
    const commandId =
      input.commandId !== undefined && input.commandId.length > 0 ? input.commandId : randomUUID();
    const run = (tx: BaseRepoTx, repo: BaseRepository) => this.resetInTx(tx, repo, principal, commandId);
    if (typeof this.deps.db.transaction !== "function") {
      return run(this.deps.db, this.deps.repo);
    }
    return this.deps.db.transaction(async (tx) =>
      run(tx as unknown as BaseRepoTx, this.deps.repo.forTransaction(tx as unknown as BaseRepoTx))
    );
  }

  private async resetInTx(
    tx: BaseRepoTx,
    repo: BaseRepository,
    principal: { accountId: string },
    commandId: string
  ): Promise<{ baseId: string; duplicate: boolean }> {
    const actorScope = `account:${principal.accountId}`;
    const requestHash = hashRequestPayload({});

    const existing = await repo.findReceiptForUpdate(tx, actorScope, BASE_RESET_COMMAND_KIND, commandId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new BaseOperationError("IDEMPOTENCY_CONFLICT", "同一命令ID对应了不同请求。");
      }
      const replay = existing.result as { baseId?: unknown } | null;
      if (!replay || typeof replay.baseId !== "string") {
        throw new BaseOperationError("IDEMPOTENCY_CONFLICT", "命令收据缺少可重放结果。");
      }
      // 幂等重放：重开已完成，返回当时的新 baseId，不再删档。
      return { baseId: replay.baseId, duplicate: true };
    }

    const claimed = await repo.claimReceipt(tx, {
      actorScope,
      commandKind: BASE_RESET_COMMAND_KIND,
      commandId,
      requestHash
    });
    if (!claimed) {
      throw new BaseOperationError("IDEMPOTENCY_CONFLICT", "命令正在处理中，请稍后重试。");
    }

    const previousBaseId = await repo.findBaseIdByAccount(tx, principal.accountId);
    if (previousBaseId === null) {
      throw new BaseOperationError("BASE_SCOPE_INVALID", "账号没有可重开的基地。");
    }

    // 与 tick 结算/玩家命令同一把基地行锁：锁住后才允许删除，并发推进者要么先
    // 提交（本事务随后整体覆盖）、要么等本事务提交后看到的是新基地。
    const previousBase = await repo.getBaseForUpdate(tx, previousBaseId);
    if (!previousBase) {
      // 并发重开刚好删掉了这行：对本命令而言是"状态已变化，请刷新后重试"。
      throw new BaseOperationError("REVISION_EXPIRED", "基地状态已变化，请刷新后重试。");
    }

    // 删除旧基地全部数据（FK 闭包，子→父）与其命令收据；任一步失败整体回滚。
    // deleter 必须以本事务构造：绑死根连接会把删除游离到事务外（自动提交、破坏原子性）。
    const deleter = this.deps.openDeleter(tx);
    await deleter.deleteBaseClosure({ baseId: previousBaseId });
    await deleter.deleteBaseCommandReceipts({
      baseId: previousBaseId,
      accountId: principal.accountId
    });

    // 注册同款 provision 在同一事务内重建新档（landing 内容、初始倍速、新 baseId）。
    // 旧基地已删，provision 的"账号已有基地"分支不会命中，必然走全新种子装配。
    const provisioned = await this.deps.provisionInTx(tx, repo, {
      accountId: principal.accountId,
      commandId: randomUUID()
    });

    await this.deps.openAudit(tx).write({
      actorAccountId: principal.accountId,
      action: "base.reset",
      targetType: "base",
      targetId: provisioned.baseId,
      reason: "player_requested_base_reset",
      metadata: {
        commandId,
        previousBaseId,
        previousContentRelease: previousBase.contentRelease,
        newBaseId: provisioned.baseId
      }
    });

    const result = { baseId: provisioned.baseId, duplicate: false };
    await repo.saveReceiptResult(tx, {
      actorScope,
      commandKind: BASE_RESET_COMMAND_KIND,
      commandId,
      result
    });
    return result;
  }
}
