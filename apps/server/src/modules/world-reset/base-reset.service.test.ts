import { describe, expect, it, vi } from "vitest";
import { BaseResetService } from "./base-reset.service.js";
import type { BaseResetDeps } from "./base-reset.service.js";
import { hashRequestPayload, type BaseCommandReceipt, type BaseRepository } from "../world-runtime/base.repository.js";
import type { AuditWriter } from "../audit/audit.service.js";

// 账号重开编排的单元回归：收据幂等/调用顺序/失败路径（事务原子性由真 PG 集成测试证明）。

function makeReceipt(overrides: Partial<BaseCommandReceipt> = {}): BaseCommandReceipt {
  return {
    actorScope: "account:acc-1",
    commandKind: "base.resetBase",
    commandId: "cmd-1",
    worldEpoch: 1,
    requestHash: hashRequestPayload({}),
    result: null,
    ...overrides
  };
}

interface Harness {
  deps: BaseResetDeps;
  repo: {
    findReceiptForUpdate: ReturnType<typeof vi.fn>;
    claimReceipt: ReturnType<typeof vi.fn>;
    findBaseIdByAccount: ReturnType<typeof vi.fn>;
    getBaseForUpdate: ReturnType<typeof vi.fn>;
    saveReceiptResult: ReturnType<typeof vi.fn>;
  };
  deleter: {
    deleteBaseClosure: ReturnType<typeof vi.fn>;
    deleteBaseCommandReceipts: ReturnType<typeof vi.fn>;
  };
  provisionInTx: ReturnType<typeof vi.fn>;
  auditWrite: ReturnType<typeof vi.fn>;
}

type DeleterStub = {
  deleteBaseClosure: ReturnType<typeof vi.fn>;
  deleteBaseCommandReceipts: ReturnType<typeof vi.fn>;
};

function makeHarness(input: {
  existingReceipt?: BaseCommandReceipt | null;
  ownedBaseId?: string | null;
  provisionBaseId?: string;
  provisionError?: Error;
}): Harness {
  const repo = {
    findReceiptForUpdate: vi.fn(async () => input.existingReceipt ?? null),
    claimReceipt: vi.fn(async () => true),
    findBaseIdByAccount: vi.fn(async () => input.ownedBaseId ?? null),
    getBaseForUpdate: vi.fn(async () =>
      input.ownedBaseId
        ? { id: input.ownedBaseId, contentRelease: "yudian-base-0", baseRevision: 7 }
        : null
    ),
    saveReceiptResult: vi.fn(async () => undefined)
  };
  const deleter = {
    deleteBaseClosure: vi.fn(async () => undefined),
    deleteBaseCommandReceipts: vi.fn(async () => undefined)
  };
  const provisionInTx = vi.fn(async () => {
    if (input.provisionError) throw input.provisionError;
    return { baseId: input.provisionBaseId ?? "base-new" };
  });
  const auditWrite = vi.fn(async () => undefined);
  const openAudit = vi.fn((): AuditWriter => ({ write: auditWrite }));
  const deps: BaseResetDeps = {
    // 无 transaction 函数：走直连路径（与 BaseService.transact 的测试替身口径一致）。
    db: {} as unknown as BaseResetDeps["db"],
    repo: repo as unknown as BaseRepository,
    openDeleter: () => deleter as unknown as ReturnType<NonNullable<BaseResetDeps["openDeleter"]>>,
    provisionInTx: provisionInTx as unknown as BaseResetDeps["provisionInTx"],
    openAudit
  };
  return { deps, repo, deleter: deleter as unknown as DeleterStub, provisionInTx, auditWrite };
}

describe("BaseResetService", () => {
  it("重开：锁基地 → 删闭包 → 删收据 → 重建 → 审计 → 落收据，返回新 baseId", async () => {
    const h = makeHarness({ ownedBaseId: "base-old", provisionBaseId: "base-new" });

    const result = await new BaseResetService(h.deps).resetBase(
      { accountId: "acc-1" },
      { commandId: "cmd-1" }
    );

    expect(result).toEqual({ baseId: "base-new", duplicate: false });
    expect(h.repo.claimReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorScope: "account:acc-1", commandKind: "base.resetBase", commandId: "cmd-1" })
    );
    expect(h.repo.getBaseForUpdate).toHaveBeenCalledWith(expect.anything(), "base-old");
    expect(h.deleter.deleteBaseClosure).toHaveBeenCalledWith({ baseId: "base-old" });
    expect(h.deleter.deleteBaseCommandReceipts).toHaveBeenCalledWith({ baseId: "base-old", accountId: "acc-1" });
    // 重建必须发生在删除之后（同一事务内先删后建）。
    expect(h.provisionInTx.mock.invocationCallOrder[0]!).toBeGreaterThan(
      h.deleter.deleteBaseClosure.mock.invocationCallOrder[0]!
    );
    expect(h.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAccountId: "acc-1",
        action: "base.reset",
        targetType: "base",
        targetId: "base-new",
        metadata: expect.objectContaining({ previousBaseId: "base-old", newBaseId: "base-new" })
      })
    );
    expect(h.repo.saveReceiptResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ commandKind: "base.resetBase", commandId: "cmd-1", result: { baseId: "base-new", duplicate: false } })
    );
  });

  it("幂等重放：同 commandId 已有收据时直接返回当时的新 baseId，不再删档", async () => {
    const h = makeHarness({
      existingReceipt: makeReceipt({ result: { baseId: "base-new", duplicate: false } })
    });

    const result = await new BaseResetService(h.deps).resetBase({ accountId: "acc-1" }, { commandId: "cmd-1" });

    expect(result).toEqual({ baseId: "base-new", duplicate: true });
    expect(h.repo.claimReceipt).not.toHaveBeenCalled();
    expect(h.deleter.deleteBaseClosure).not.toHaveBeenCalled();
    expect(h.deleter.deleteBaseCommandReceipts).not.toHaveBeenCalled();
    expect(h.provisionInTx).not.toHaveBeenCalled();
    expect(h.auditWrite).not.toHaveBeenCalled();
  });

  it("没有基地时拒绝（BASE_SCOPE_INVALID），不做任何删除", async () => {
    const h = makeHarness({ ownedBaseId: null });

    await expect(
      new BaseResetService(h.deps).resetBase({ accountId: "acc-1" }, { commandId: "cmd-1" })
    ).rejects.toMatchObject({ code: "BASE_SCOPE_INVALID" });

    expect(h.deleter.deleteBaseClosure).not.toHaveBeenCalled();
    expect(h.provisionInTx).not.toHaveBeenCalled();
    expect(h.auditWrite).not.toHaveBeenCalled();
  });

  it("重建失败：审计与收据不落（真事务下整体回滚，旧档不丢）", async () => {
    const h = makeHarness({ ownedBaseId: "base-old", provisionError: new Error("seed exploded") });

    await expect(
      new BaseResetService(h.deps).resetBase({ accountId: "acc-1" }, { commandId: "cmd-1" })
    ).rejects.toThrow("seed exploded");

    expect(h.deleter.deleteBaseClosure).toHaveBeenCalledWith({ baseId: "base-old" });
    expect(h.auditWrite).not.toHaveBeenCalled();
    expect(h.repo.saveReceiptResult).not.toHaveBeenCalled();
  });

  it("缺省 commandId 时自动生成并在整个重开中使用", async () => {
    const h = makeHarness({ ownedBaseId: "base-old", provisionBaseId: "base-new" });

    await new BaseResetService(h.deps).resetBase({ accountId: "acc-1" }, {});

    const claim = h.repo.claimReceipt.mock.calls[0]?.[1] as { commandId: string };
    expect(typeof claim.commandId).toBe("string");
    expect(claim.commandId.length).toBeGreaterThan(0);
    expect(h.repo.saveReceiptResult.mock.calls[0]?.[1]).toMatchObject({ commandId: claim.commandId });
  });
});
