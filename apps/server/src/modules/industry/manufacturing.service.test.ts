// M13-C 创建/取消制造工单业务测试（全部内存假端口，无真库、无真事务）。
// 回执 requestHash 由被测服务内部计算；测试只经服务自身播种收据，避免复制哈希细节。
// 配方 fixture = m13-p-contract.md §5（manufacture-yd-h1）。
import { describe, expect, it } from "vitest";
import type { RecipeTemplateDto } from "@ai-mud/shared";
import {
  BaseOperationError,
  ManufacturingService,
  type ManufacturingAssetPort,
  type ManufacturingCatalogPort,
  type ManufacturingLookupPort,
  type ManufacturingReceiptsPort,
  type ManufacturingServiceDeps,
  type ManufacturingTx
} from "./manufacturing.service.js";
import type {
  InsertManufacturingJobInput,
  ManufacturingJobRecord,
  ManufacturingJobStore,
  ManufacturingTx as RepoTx
} from "./manufacturing.repository.js";

const RECIPE: RecipeTemplateDto = {
  ref: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 1 },
  name: "制造余电-H1",
  description: "整机装配：余电-H1 巡检机器人",
  inputs: [
    { itemId: "support_frame", quantity: 4 },
    { itemId: "spare_parts", quantity: 6 },
    { itemId: "power_box", quantity: 1 }
  ],
  workPerUnit: 30,
  output: { templateStableId: "yd-h1", initialBatteryWh: 12000 }
};

const CREATE_INPUT = {
  recipeRef: { kind: "recipe" as const, stableId: "manufacture-yd-h1", revision: 1 },
  outputsPlanned: 2,
  commandId: "cmd-create-1"
};

// 全额预留 = inputs × outputsPlanned（×2）
const TOTAL_INPUTS = [
  { itemId: "support_frame", quantity: 8 },
  { itemId: "spare_parts", quantity: 12 },
  { itemId: "power_box", quantity: 2 }
];

class FakeLookup implements ManufacturingLookupPort {
  locked: string[] = [];
  constructor(private readonly baseByAccount: Map<string, string>) {}
  async findBaseIdByAccount(_tx: ManufacturingTx, accountId: string): Promise<string | null> {
    return this.baseByAccount.get(accountId) ?? null;
  }
  async getBaseForUpdate(_tx: ManufacturingTx, baseId: string): Promise<{ id: string } | null> {
    this.locked.push(baseId);
    return [...this.baseByAccount.values()].includes(baseId) ? { id: baseId } : null;
  }
}

class FakeAssets implements ManufacturingAssetPort {
  reserved: Array<{ itemId: string; quantity: number }> = [];
  released: Array<{ itemId: string; quantity: number }> = [];
  failItems = new Set<string>();

  async reserveBaseInventoryIfAvailable(
    _tx: ManufacturingTx,
    _baseId: string,
    itemId: string,
    quantity: number
  ): Promise<boolean> {
    if (this.failItems.has(itemId)) return false;
    this.reserved.push({ itemId, quantity });
    return true;
  }

  async releaseReservedBaseInventory(
    _tx: ManufacturingTx,
    _baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    this.released.push({ itemId, quantity });
  }
}

class FakeCatalog implements ManufacturingCatalogPort {
  recipes = new Map<string, RecipeTemplateDto | null>([
    [RECIPE.ref.stableId, RECIPE]
  ]);
  getRecipeTemplate(stableId: string): RecipeTemplateDto | null {
    return this.recipes.get(stableId) ?? null;
  }
}

class FakeStore implements ManufacturingJobStore {
  inserted: Array<{ baseId: string; outputsPlanned: number; reservedInputs: Array<{ itemId: string; quantity: number }> }> = [];
  jobs = new Map<string, ManufacturingJobRecord>();
  statusCalls: Array<{ jobId: string; status: string }> = [];
  private sequence = 0;

  async insertJob(
    _tx: RepoTx,
    input: InsertManufacturingJobInput
  ): Promise<{ jobId: string }> {
    this.sequence += 1;
    const jobId = `job-${this.sequence}`;
    this.inserted.push({
      baseId: input.baseId,
      outputsPlanned: input.outputsPlanned,
      reservedInputs: input.reservedInputs
    });
    this.jobs.set(jobId, {
      id: jobId,
      baseId: input.baseId,
      recipeDefId: input.recipeDefId,
      recipeRevision: input.recipeRevision,
      status: "active",
      outputsPlanned: input.outputsPlanned,
      outputsDone: 0,
      currentUnitWorkDone: 0,
      reservedInputs: input.reservedInputs.map((item) => ({ ...item })),
      blockedReason: null
    });
    return { jobId };
  }

  async findJob(_tx: RepoTx, baseId: string, jobId: string): Promise<ManufacturingJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.baseId !== baseId) return null;
    return job;
  }

  async updateJobStatus(_tx: RepoTx, jobId: string, status: ManufacturingJobRecord["status"]): Promise<void> {
    this.statusCalls.push({ jobId, status });
    const job = this.jobs.get(jobId);
    if (job) job.status = status;
  }
}

interface ReceiptRow {
  actorScope: string;
  commandKind: string;
  commandId: string;
  worldEpoch: number;
  requestHash: string;
  result: unknown;
}

class FakeReceipts implements ManufacturingReceiptsPort {
  rows = new Map<string, ReceiptRow>();
  savedResults: unknown[] = [];

  private key(actorScope: string, commandKind: string, commandId: string): string {
    return `${actorScope}|${commandKind}|${commandId}`;
  }

  async findReceiptForUpdate(
    actorScope: string,
    commandKind: string,
    commandId: string
  ): Promise<ReceiptRow | null> {
    return this.rows.get(this.key(actorScope, commandKind, commandId)) ?? null;
  }

  async claimReceipt(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    requestHash: string;
  }): Promise<boolean> {
    const key = this.key(input.actorScope, input.commandKind, input.commandId);
    if (this.rows.has(key)) return false;
    this.rows.set(key, {
      actorScope: input.actorScope,
      commandKind: input.commandKind,
      commandId: input.commandId,
      worldEpoch: 1,
      requestHash: input.requestHash,
      result: { status: "pending" }
    });
    return true;
  }

  async saveReceiptResult(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    result: unknown;
  }): Promise<void> {
    this.savedResults.push(input.result);
    const row = this.rows.get(this.key(input.actorScope, input.commandKind, input.commandId));
    if (row) row.result = input.result;
  }
}

function makeService(overrides: {
  baseByAccount?: Map<string, string>;
  failItems?: Set<string>;
} = {}) {
  const lookup = new FakeLookup(overrides.baseByAccount ?? new Map([["account-1", "base-1"]]));
  const assets = new FakeAssets();
  if (overrides.failItems) assets.failItems = overrides.failItems;
  const catalog = new FakeCatalog();
  const store = new FakeStore();
  const receipts = new FakeReceipts();
  const deps: ManufacturingServiceDeps = {
    lookup,
    assets,
    catalog,
    store,
    receipts: () => receipts
  };
  return { service: new ManufacturingService(deps), lookup, assets, catalog, store, receipts };
}

const tx = {} as ManufacturingTx;
const principal = { accountId: "account-1" };

async function createFirstJob(service: ManufacturingService) {
  return service.create(tx, principal, CREATE_INPUT);
}

describe("ManufacturingService.create", () => {
  it("happy path：inputs×台数全额预留 → 插 active 工单（reserved_inputs=totalInputs）→ 回执落结果", async () => {
    const { service, assets, store, receipts } = makeService();

    const result = await createFirstJob(service);

    expect(result).toEqual({ jobId: "job-1", duplicate: false });
    expect(assets.reserved).toEqual(TOTAL_INPUTS);
    expect(store.inserted).toEqual([
      { baseId: "base-1", outputsPlanned: 2, reservedInputs: TOTAL_INPUTS }
    ]);
    const saved = receipts.savedResults.at(-1);
    expect(saved).toEqual({ jobId: "job-1", duplicate: false });
  });

  it("任一 input 不足 → RESOURCE_INSUFFICIENT 整体回滚，不插工单", async () => {
    const { service, store } = makeService({ failItems: new Set(["power_box"]) });

    const failure = createFirstJob(service);

    await expect(failure).rejects.toMatchObject({
      code: "RESOURCE_INSUFFICIENT",
      statusCode: 409
    });
    expect(store.inserted).toHaveLength(0);
  });

  it("重复 commandId 且请求一致 → 原样重放 duplicate=true，不重复预留/建单；不一致 → IDEMPOTENCY_CONFLICT", async () => {
    const { service, assets, store } = makeService();
    await createFirstJob(service);

    const replay = await service.create(tx, principal, {
      recipeRef: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 1 },
      outputsPlanned: 2,
      commandId: "cmd-create-1"
    });
    expect(replay).toEqual({ jobId: "job-1", duplicate: true });
    expect(store.inserted).toHaveLength(1);
    expect(assets.reserved).toHaveLength(3); // 仅首次的三项 input

    const conflict = service.create(tx, principal, { ...CREATE_INPUT, outputsPlanned: 3 });
    await expect(conflict).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      statusCode: 409
    });
  });

  it("配方不存在或 revision 不匹配 → CONTENT_INCOMPATIBLE，不 fallback latest", async () => {
    const missing = makeService();
    missing.catalog.recipes.set("manufacture-yd-h1", null);
    await expect(createFirstJob(missing.service)).rejects.toMatchObject({
      code: "CONTENT_INCOMPATIBLE",
      statusCode: 409
    });

    const stale = makeService();
    stale.catalog.recipes.set("manufacture-yd-h1", {
      ...RECIPE,
      ref: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 2 }
    });
    await expect(createFirstJob(stale.service)).rejects.toMatchObject({
      code: "CONTENT_INCOMPATIBLE"
    });
  });

  it("outputsPlanned 越界（0/21）→ VALIDATION_ERROR；账号无基地 → BASE_SCOPE_INVALID（403）", async () => {
    const { service } = makeService();
    await expect(
      service.create(tx, principal, { ...CREATE_INPUT, outputsPlanned: 0 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    await expect(
      service.create(tx, principal, { ...CREATE_INPUT, outputsPlanned: 21 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const noBase = makeService({ baseByAccount: new Map() });
    await expect(createFirstJob(noBase.service)).rejects.toMatchObject({
      code: "BASE_SCOPE_INVALID",
      statusCode: 403
    });
  });
});

describe("ManufacturingService.cancel", () => {
  it("取消：释放全部剩余预留 → cancelled → 回执落结果", async () => {
    const { service, lookup, assets, store } = makeService();
    await createFirstJob(service);

    const result = await service.cancel(tx, principal, {
      jobId: "job-1",
      commandId: "cmd-cancel-1"
    });

    expect(result).toEqual({
      cancelled: true,
      duplicate: false,
      releasedInputs: TOTAL_INPUTS
    });
    expect(assets.released).toEqual(TOTAL_INPUTS);
    expect(store.statusCalls).toEqual([{ jobId: "job-1", status: "cancelled" }]);
    expect(lookup.locked).toEqual(["base-1"]);
  });

  it("取消只释放剩余预留（结算逐台消耗后 reserved_inputs 已递减）", async () => {
    const { service, store, assets } = makeService();
    await createFirstJob(service);
    // 模拟结算产出 1 台后的剩余预留（reserved_inputs 递减）
    const job = store.jobs.get("job-1");
    if (job) {
      job.reservedInputs = [
        { itemId: "support_frame", quantity: 4 },
        { itemId: "spare_parts", quantity: 6 },
        { itemId: "power_box", quantity: 1 }
      ];
    }

    const result = await service.cancel(tx, principal, {
      jobId: "job-1",
      commandId: "cmd-cancel-1"
    });

    expect(result.releasedInputs).toEqual([
      { itemId: "support_frame", quantity: 4 },
      { itemId: "spare_parts", quantity: 6 },
      { itemId: "power_box", quantity: 1 }
    ]);
    expect(assets.released).toEqual(result.releasedInputs);
  });

  it("取消重放：重复 commandId → 原结果 duplicate=true，不二次释放", async () => {
    const { service, assets } = makeService();
    await createFirstJob(service);
    await service.cancel(tx, principal, { jobId: "job-1", commandId: "cmd-cancel-1" });

    const replay = await service.cancel(tx, principal, {
      jobId: "job-1",
      commandId: "cmd-cancel-1"
    });

    expect(replay).toEqual({
      cancelled: true,
      duplicate: true,
      releasedInputs: TOTAL_INPUTS
    });
    expect(assets.released).toHaveLength(3); // 仅首次取消释放
  });

  it("终态工单（completed）→ CONFLICT；他基地工单 → BASE_SCOPE_INVALID（403 防探测）", async () => {
    const foreign = makeService();
    await expect(
      foreign.service.cancel(tx, principal, { jobId: "no-such", commandId: "cmd-x" })
    ).rejects.toMatchObject({ code: "BASE_SCOPE_INVALID", statusCode: 403 });

    const completed = makeService();
    await createFirstJob(completed.service);
    const job = completed.store.jobs.get("job-1");
    if (job) job.status = "completed";
    await expect(
      completed.service.cancel(tx, principal, { jobId: "job-1", commandId: "cmd-y" })
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });
});

describe("BaseOperationError（再导出）", () => {
  it("携带 ErrorCode 与 HTTP 状态码", () => {
    const error = new BaseOperationError(409, "CONFLICT", "占用");
    expect(error.code).toBe("CONFLICT");
    expect(error.statusCode).toBe(409);
  });
});
