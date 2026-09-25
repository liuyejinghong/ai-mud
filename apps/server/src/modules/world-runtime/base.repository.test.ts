import { describe, expect, it } from "vitest";
import type { NodePgClient } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { BASE_MAX_CATCHUP_MS } from "@ai-mud/shared";
import type { BaseDb, BaseRepoTx } from "./base.repository.js";
import {
  BaseRepository,
  hashRequestPayload,
  scopeTickTransactionToBase
} from "./base.repository.js";

// M12-A 仓储用例：真实 drizzle 查询构建 + 假 pg 客户端（内存行存储）。
// 覆盖：lockAdvanceableBases 的推进政策（pause 不返回 / 租约过期不返回 /
// delta 封顶 ×speed / 未来 lastAdvancedAt 钳 0）、updateBaseClock 的
// base_revision 乐观守卫、saveSimAdvance 的 sim_time/last_advanced_at/revision+1、
// 控制租约 upsert、账号作用域命令回执、基地/建设位读写。
// 真库并发语义由 test:postgres 的 M12-Q 集成测试另行验收。

const NOW = new Date("2026-09-19T12:00:00.000Z");
const MINUTE_MS = 60_000;

// 迷你查询引擎：按 SQL 文本路由到内存表，模拟 where 过滤与 limit；
// 行以 snake_case 列存储，select 投影按 SQL 列序映射为数组行（rowMode: "array"）。
class FakePgClient {
  queries: Array<{ text: string; params: unknown[] }> = [];
  bases: Array<Record<string, unknown>> = [];
  sites: Array<Record<string, unknown>> = [];
  leases: Array<Record<string, unknown>> = [];
  receipts: Array<Record<string, unknown>> = [];
  private counter = 0;

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  async query(config: { text: string }, params: unknown[]): Promise<{
    rows: unknown[][];
    rowCount: number;
    fields: unknown[];
  }> {
    const text = config.text;
    this.queries.push({ text, params });

    if (text.startsWith("select")) {
      let rows: Array<Record<string, unknown>> = [];
      if (/from "bases" inner join "base_control_leases"/.test(text)) {
        // 到期清单：running ∧ lease_until > $2（按 id 排序由 SQL 声明，这里按 id 排序模拟）。
        rows = this.bases
          .filter((base) => base.time_mode === params[0])
          .filter((base) =>
            this.leases.some(
              (lease) =>
                lease.base_id === base.id &&
                (lease.lease_until as Date).getTime() > new Date(params[1] as string).getTime()
            )
          )
          .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      } else if (/from "bases"/.test(text)) {
        rows = this.filterBases(text, params);
      } else if (/from "base_control_leases"/.test(text)) {
        rows = this.leases.filter((lease) => lease.base_id === params[0]);
      } else if (/from "base_sites"/.test(text)) {
        rows = this.sites;
        if (/"base_id" = \$/.test(text)) rows = rows.filter((site) => site.base_id === params[0]);
        if (/"id" = \$/.test(text)) {
          const idParam = /"base_id" = \$/.test(text) ? params[1] : params[0];
          rows = rows.filter((site) => site.id === idParam);
        }
      } else if (/from "command_receipts"/.test(text)) {
        rows = this.receipts.filter(
          (receipt) =>
            receipt.actor_scope === params[0] &&
            receipt.command_kind === params[1] &&
            receipt.command_id === params[2] &&
            receipt.world_epoch === params[3]
        );
      }
      if (/\blimit\s+1\b/.test(text)) rows = rows.slice(0, 1);
      return { rows: this.project(text, rows), rowCount: rows.length, fields: [] };
    }

    if (text.startsWith('insert into "bases"')) {
      const record: Record<string, unknown> = {
        id: this.nextId("base"),
        account_id: params[0],
        name: params[1],
        time_mode: params[2],
        speed: params[3],
        sim_time: params[4],
        last_advanced_at: params[5],
        content_release: params[6],
        epoch: 1,
        base_revision: 1,
        created_at: NOW
      };
      this.bases.push(record);
      return { rows: [[record.id]], rowCount: 1, fields: [] };
    }

    if (text.startsWith('insert into "base_sites"')) {
      const record: Record<string, unknown> = {
        id: this.nextId("site"),
        base_id: params[0],
        site_key: params[1],
        state: params[2],
        built_facility_ref: params[3],
        created_at: NOW
      };
      this.sites.push(record);
      return { rows: [[record.id]], rowCount: 1, fields: [] };
    }

    if (text.startsWith('insert into "base_control_leases"')) {
      const baseId = params[0];
      const existing = this.leases.find((lease) => lease.base_id === baseId);
      if (existing && /on conflict/.test(text)) {
        existing.lease_token = params[1];
        existing.lease_until = params[2];
        existing.updated_at = params[3];
        return { rows: [], rowCount: 1, fields: [] };
      }
      this.leases.push({
        base_id: baseId,
        lease_token: params[1],
        lease_until: params[2],
        updated_at: params[3]
      });
      return { rows: [], rowCount: 1, fields: [] };
    }

    if (text.startsWith('insert into "command_receipts"')) {
      const key = (record: Record<string, unknown>) =>
        `${record.actor_scope}|${record.command_kind}|${record.command_id}|${record.world_epoch}`;
      const incoming = {
        actor_scope: params[0],
        command_kind: params[1],
        command_id: params[2],
        world_epoch: params[3],
        request_hash: params[4],
        result: params[5]
      };
      if (this.receipts.some((receipt) => key(receipt) === key(incoming))) {
        return { rows: [], rowCount: 0, fields: [] }; // onConflictDoNothing 命中
      }
      const id = this.nextId("rcpt");
      this.receipts.push({ id, ...incoming });
      return { rows: [[id]], rowCount: 1, fields: [] };
    }

    if (text.startsWith('update "bases"')) {
      if (/"base_revision" = \$/.test(text)) {
        // updateBaseClock：set[time_mode, speed, last_advanced_at] + where[id, base_revision]
        const expected = Number(params[params.length - 1]);
        const baseId = String(params[params.length - 2]);
        const record = this.bases.find((base) => base.id === baseId);
        if (!record || record.base_revision !== expected) {
          return { rows: [], rowCount: 0, fields: [] };
        }
        record.time_mode = params[0];
        record.speed = params[1];
        record.last_advanced_at = params[2];
        record.base_revision = expected + 1;
        return { rows: [], rowCount: 1, fields: [] };
      }
      // saveSimAdvance：set[sim_time, last_advanced_at] + where[id]
      const record = this.bases.find((base) => base.id === params[2]);
      if (!record) return { rows: [], rowCount: 0, fields: [] };
      record.sim_time = params[0];
      record.last_advanced_at = params[1];
      record.base_revision = Number(record.base_revision) + 1;
      return { rows: [], rowCount: 1, fields: [] };
    }

    if (text.startsWith('update "base_sites"')) {
      const record = this.sites.find((site) => site.id === params[params.length - 1]);
      if (!record) return { rows: [], rowCount: 0, fields: [] };
      record.state = params[0];
      record.built_facility_ref = /"built_facility_ref"/.test(text) ? params[1] : null;
      return { rows: [], rowCount: 1, fields: [] };
    }

    if (text.startsWith('update "command_receipts"')) {
      const record = this.receipts.find(
        (receipt) =>
          receipt.actor_scope === params[1] &&
          receipt.command_kind === params[2] &&
          receipt.command_id === params[3] &&
          receipt.world_epoch === params[4]
      );
      if (!record) return { rows: [], rowCount: 0, fields: [] };
      record.result = params[0];
      return { rows: [], rowCount: 1, fields: [] };
    }

    return { rows: [], rowCount: 0, fields: [] };
  }

  private filterBases(text: string, params: unknown[]): Array<Record<string, unknown>> {
    if (/"time_mode" = \$1 and "bases"."id" = \$2/.test(text)) {
      return this.bases.filter((base) => base.time_mode === params[0] && base.id === params[1]);
    }
    if (/"account_id" = \$/.test(text)) {
      return this.bases.filter((base) => base.account_id === params[0]);
    }
    if (/"id" = \$/.test(text)) {
      return this.bases.filter((base) => base.id === params[0]);
    }
    if (/"time_mode" = \$/.test(text)) {
      return this.bases.filter((base) => base.time_mode === params[0]);
    }
    return [...this.bases];
  }

  // 从 SQL 的 select 列表取列名（兼容 "table"."col" 限定），映射内存行为数组行。
  private project(text: string, rows: Array<Record<string, unknown>>): unknown[][] {
    const match = /^select\s+([\s\S]+?)\s+from\s/.exec(text);
    if (!match) return rows.map((row) => Object.values(row));
    const columns = (match[1] ?? "").split(",").map((piece) => {
      const quoted = piece.trim().match(/"([^"]+)"/g) ?? [];
      const last = quoted.at(-1) ?? '""';
      return last.slice(1, -1);
    });
    return rows.map((row) => columns.map((column) => row[column] ?? null));
  }
}

function createRepository(wallClockNow: Date = NOW) {
  const client = new FakePgClient();
  const db = drizzle(client as unknown as NodePgClient);
  const repo = new BaseRepository(db as unknown as BaseDb, { now: () => wallClockNow });
  const tx = db as unknown as BaseRepoTx;
  return { client, repo, tx };
}

let baseSeq = 0;

function seedBase(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  baseSeq += 1;
  return {
    id: `b-seed-${baseSeq}`,
    account_id: "acc-1",
    name: "余电前哨",
    time_mode: "running",
    speed: 1,
    sim_time: new Date(NOW.getTime() - 10 * MINUTE_MS),
    last_advanced_at: new Date(NOW.getTime() - MINUTE_MS),
    epoch: 1,
    base_revision: 1,
    content_release: "release-yudian-0.12",
    created_at: NOW,
    ...overrides
  };
}

describe("BaseRepository.lockAdvanceableBases", () => {
  it("locks only running bases with a valid lease and applies the catch-up cap times speed", async () => {
    const { client, repo, tx } = createRepository();
    const normal = seedBase({
      id: "b-normal",
      speed: 2,
      last_advanced_at: new Date(NOW.getTime() - MINUTE_MS)
    });
    const capped = seedBase({
      id: "b-capped",
      speed: 4,
      last_advanced_at: new Date(NOW.getTime() - 30 * MINUTE_MS) // 超过 10 分钟追补上限
    });
    const paused = seedBase({ id: "b-paused", time_mode: "paused" });
    const noLease = seedBase({ id: "b-no-lease" });
    const expired = seedBase({
      id: "b-expired",
      last_advanced_at: new Date(NOW.getTime() - 5 * MINUTE_MS)
    });
    client.bases.push(normal, capped, paused, noLease, expired);
    client.leases.push(
      {
        base_id: "b-normal",
        lease_token: "t",
        lease_until: new Date(NOW.getTime() + MINUTE_MS),
        updated_at: NOW
      },
      {
        base_id: "b-capped",
        lease_token: "t",
        lease_until: new Date(NOW.getTime() + MINUTE_MS),
        updated_at: NOW
      },
      {
        base_id: "b-expired",
        lease_token: "t",
        lease_until: new Date(NOW.getTime() - MINUTE_MS),
        updated_at: NOW
      }
    );

    const advanceable = await repo.lockAdvanceableBases(tx, NOW);

    // pause 不返回、无租约不返回、租约过期不返回。
    expect(advanceable.map((base) => base.baseId)).toEqual(["b-normal", "b-capped"]);
    expect(client.queries[0]?.text).toContain("for update");
    expect(client.queries[0]?.text).toContain('"time_mode"');
    expect(client.queries[0]?.params[0]).toBe("running");

    const normalEntry = advanceable.find((base) => base.baseId === "b-normal");
    expect(normalEntry).toMatchObject({
      baseId: "b-normal",
      simTime: normal.sim_time,
      speed: 2,
      deltaSimMs: MINUTE_MS * 2, // Δwall 60s × speed 2
      nextLastAdvancedAt: NOW
    });

    // delta 封顶：Δwall 被钳到 BASE_MAX_CATCHUP_MS，再乘 speed。
    const cappedEntry = advanceable.find((base) => base.baseId === "b-capped");
    expect(cappedEntry?.deltaSimMs).toBe(BASE_MAX_CATCHUP_MS * 4);
  });

  it("clamps a future lastAdvancedAt to a zero delta instead of producing negative sim time", async () => {
    const { client, repo, tx } = createRepository();
    client.bases.push(
      seedBase({
        id: "b-future",
        last_advanced_at: new Date(NOW.getTime() + 5 * MINUTE_MS) // 时钟回拨场景
      })
    );
    client.leases.push({
      base_id: "b-future",
      lease_token: "t",
      lease_until: new Date(NOW.getTime() + MINUTE_MS),
      updated_at: NOW
    });

    const advanceable = await repo.lockAdvanceableBases(tx, NOW);

    // Δwall <= 0 的基地被跳过，不产生任何推进记录。
    expect(advanceable).toHaveLength(0);
  });
});

describe("BaseRepository per-base tick isolation (车道 C4)", () => {
  function leaseFor(baseId: string, untilOffsetMs = MINUTE_MS) {
    return {
      base_id: baseId,
      lease_token: "t",
      lease_until: new Date(NOW.getTime() + untilOffsetMs),
      updated_at: NOW
    };
  }

  it("locks running bases in a deterministic order and skips rows another transaction holds", async () => {
    const { client, repo, tx } = createRepository();
    client.bases.push(seedBase({ id: "b-1" }));
    client.leases.push(leaseFor("b-1"));

    await repo.lockAdvanceableBases(tx, NOW);

    const lockQuery = client.queries[0]?.text ?? "";
    expect(lockQuery).toContain('order by "bases"."id"');
    expect(lockQuery).toContain("for update skip locked");
  });

  it("only locks and returns the base a tick transaction is scoped to", async () => {
    const { client, repo, tx } = createRepository();
    client.bases.push(seedBase({ id: "b-1" }), seedBase({ id: "b-2" }), seedBase({ id: "b-3" }));
    client.leases.push(leaseFor("b-1"), leaseFor("b-2"), leaseFor("b-3"));

    scopeTickTransactionToBase(tx, "b-2");
    const advanceable = await repo.lockAdvanceableBases(tx, NOW);

    expect(advanceable.map((base) => base.baseId)).toEqual(["b-2"]);
    expect(client.queries[0]?.params).toEqual(["running", "b-2"]);
    expect(client.queries[0]?.text).toContain("for update skip locked");
  });

  it("does not leak a tick scope into other transaction handles", async () => {
    const scoped = createRepository();
    scoped.client.bases.push(seedBase({ id: "b-1" }));
    scoped.client.leases.push(leaseFor("b-1"));
    scopeTickTransactionToBase(scoped.tx, "b-1");

    const unscoped = createRepository();
    unscoped.client.bases.push(seedBase({ id: "b-1" }), seedBase({ id: "b-2" }));
    unscoped.client.leases.push(leaseFor("b-1"), leaseFor("b-2"));

    const advanceable = await unscoped.repo.lockAdvanceableBases(unscoped.tx, NOW);

    expect(advanceable.map((base) => base.baseId)).toEqual(["b-1", "b-2"]);
    expect(unscoped.client.queries[0]?.params).toEqual(["running"]);
  });

  it("lists due bases (running with a live lease) in id order without taking locks or N+1 lease reads", async () => {
    const { client, repo, tx } = createRepository();
    client.bases.push(
      seedBase({ id: "b-3" }),
      seedBase({ id: "b-1" }),
      seedBase({ id: "b-paused", time_mode: "paused" }),
      seedBase({ id: "b-no-lease" }),
      seedBase({ id: "b-expired" })
    );
    client.leases.push(
      leaseFor("b-3"),
      leaseFor("b-1"),
      leaseFor("b-paused"),
      leaseFor("b-expired", -MINUTE_MS)
    );

    const due = await repo.listAdvanceableBaseIds(tx);

    expect(due).toEqual(["b-1", "b-3"]);
    expect(client.queries).toHaveLength(1);
    const listQuery = client.queries[0]?.text ?? "";
    expect(listQuery).toContain('inner join "base_control_leases"');
    expect(listQuery).toContain('order by "bases"."id"');
    expect(listQuery).not.toContain("for update");
    expect(client.queries[0]?.params).toEqual(["running", NOW.toISOString()]);
  });
});

describe("BaseRepository clock writes", () => {
  it("updateBaseClock enforces the base_revision optimistic guard and bumps the revision", async () => {
    const { client, repo, tx } = createRepository();
    const base = seedBase({ id: "b-1", base_revision: 3, time_mode: "paused" });
    client.bases.push(base);
    const lastAdvancedAt = new Date(NOW.getTime());

    const ok = await repo.updateBaseClock(tx, {
      baseId: "b-1",
      expectedBaseRevision: 3,
      timeMode: "running",
      speed: 2,
      lastAdvancedAt
    });
    expect(ok).toBe(true);
    expect(base.time_mode).toBe("running");
    expect(base.speed).toBe(2);
    // drizzle 将 timestamptz 参数序列化为 ISO 字符串写入。
    expect(base.last_advanced_at).toBe(lastAdvancedAt.toISOString());
    expect(base.base_revision).toBe(4);

    // 旧 revision 重放被守卫拒绝，行保持不变。
    const stale = await repo.updateBaseClock(tx, {
      baseId: "b-1",
      expectedBaseRevision: 3,
      timeMode: "paused",
      speed: 1,
      lastAdvancedAt
    });
    expect(stale).toBe(false);
    expect(base.time_mode).toBe("running");
    expect(base.base_revision).toBe(4);
  });

  it("saveSimAdvance writes sim_time and last_advanced_at and increments base_revision", async () => {
    const { client, repo, tx } = createRepository();
    const base = seedBase({
      id: "b-1",
      base_revision: 5,
      sim_time: new Date("2026-09-19T02:00:00.000Z")
    });
    client.bases.push(base);
    const simTime = new Date("2026-09-19T02:04:00.000Z");
    const advancedAt = NOW;

    await repo.saveSimAdvance(tx, "b-1", simTime, advancedAt);

    const write = client.queries.find((query) => query.text.startsWith('update "bases"'));
    expect(write?.text).toContain('"sim_time"');
    expect(write?.text).toContain('"last_advanced_at"');
    expect(write?.text).toMatch(/"base_revision"\s*\+\s*1/);
    expect(base.sim_time).toBe(simTime.toISOString());
    expect(base.last_advanced_at).toBe(advancedAt.toISOString());
    expect(base.base_revision).toBe(6);
  });

  it("upsertControlLease keeps one row per base and refreshes the lease window", async () => {
    const { client, repo, tx } = createRepository();
    const firstUntil = new Date(NOW.getTime() + MINUTE_MS);
    const secondUntil = new Date(NOW.getTime() + 2 * MINUTE_MS);

    await repo.upsertControlLease(tx, {
      baseId: "b-1",
      leaseToken: "account:a",
      leaseUntil: firstUntil,
      updatedAt: NOW
    });
    await repo.upsertControlLease(tx, {
      baseId: "b-1",
      leaseToken: "account:a",
      leaseUntil: secondUntil,
      updatedAt: NOW
    });

    expect(client.leases).toHaveLength(1);
    const lease = await repo.getControlLease(tx, "b-1");
    expect(lease).toMatchObject({ baseId: "b-1", leaseToken: "account:a", leaseUntil: secondUntil });
    expect(await repo.getControlLease(tx, "b-missing")).toBeNull();
  });
});

describe("BaseRepository receipts", () => {
  it("claims an account-scoped receipt once and replays or conflicts on repeats", async () => {
    const { client, repo, tx } = createRepository();
    const input = {
      actorScope: "account:acc-1",
      commandKind: "base.provision",
      commandId: "cmd-1",
      requestHash: "hash-1"
    };

    expect(await repo.claimReceipt(tx, input)).toBe(true);
    expect(await repo.claimReceipt(tx, input)).toBe(false); // 唯一索引门

    const claimQuery = client.queries.find((query) => query.text.startsWith('insert into "command_receipts"'));
    expect(claimQuery?.text).toContain("on conflict");

    const receipt = await repo.findReceiptForUpdate(tx, input.actorScope, input.commandKind, input.commandId);
    expect(receipt).toMatchObject({
      actorScope: input.actorScope,
      commandKind: input.commandKind,
      commandId: input.commandId,
      worldEpoch: 1,
      requestHash: "hash-1"
    });
    const selectQuery = client.queries.find((query) => query.text.startsWith('select "actor_scope"'));
    expect(selectQuery?.text).toContain("for update");

    expect(await repo.findReceiptForUpdate(tx, input.actorScope, input.commandKind, "other")).toBeNull();

    await repo.saveReceiptResult(tx, {
      actorScope: input.actorScope,
      commandKind: input.commandKind,
      commandId: input.commandId,
      result: { baseId: "base-1", duplicate: false }
    });
    const updated = await repo.findReceiptForUpdate(tx, input.actorScope, input.commandKind, input.commandId);
    expect(updated?.result).toEqual({ baseId: "base-1", duplicate: false });
  });

  it("hashes request payloads deterministically", () => {
    expect(hashRequestPayload({})).toBe(hashRequestPayload({}));
    expect(hashRequestPayload({ a: 1 })).not.toBe(hashRequestPayload({ b: 1 }));
  });
});

describe("BaseRepository base and site rows", () => {
  it("inserts a base and resolves it by account (BaseLookupPort)", async () => {
    const { client, repo, tx } = createRepository();
    const simTime = new Date("2026-09-19T02:00:00.000Z");

    const baseId = await repo.insertBase(tx, {
      accountId: "acc-1",
      name: "余电前哨",
      contentRelease: "release-yudian-0.12",
      timeMode: "paused",
      speed: 1,
      simTime,
      lastAdvancedAt: NOW
    });

    expect(client.queries[0]?.text).toContain('insert into "bases"');
    expect(await repo.findBaseIdByAccount(tx, "acc-1")).toBe(baseId);
    expect(await repo.findBaseIdByAccount(tx, "acc-none")).toBeNull();

    const base = await repo.getBaseByAccount(tx, "acc-1");
    expect(base).toMatchObject({
      id: baseId,
      accountId: "acc-1",
      name: "余电前哨",
      timeMode: "paused",
      speed: 1,
      simTime,
      baseRevision: 1,
      contentRelease: "release-yudian-0.12"
    });
  });

  it("locks a base row for update by id", async () => {
    const { client, repo, tx } = createRepository();
    client.bases.push(seedBase({ id: "b-1" }));

    const base = await repo.getBaseForUpdate(tx, "b-1");
    expect(base?.id).toBe("b-1");
    const lockQuery = client.queries.find((query) => query.text.includes("for update"));
    expect(lockQuery?.text).toContain('from "bases"');
  });

  it("manages the site lifecycle through the BaseSiteStorePort surface", async () => {
    const { repo, tx } = createRepository();
    const baseId = "b-1";
    const arraySiteId = await repo.insertSite(tx, {
      baseId,
      siteKey: "array",
      state: "built",
      builtFacilityRef: "facility:solar_array_unit@1"
    });
    const freeSiteId = await repo.insertSite(tx, {
      baseId,
      siteKey: "site_a",
      state: "free",
      builtFacilityRef: null
    });

    const sites = await repo.listSites(tx, baseId);
    expect(sites.map((site) => site.siteKey)).toEqual(["array", "site_a"]);

    const site = await repo.getSite(tx, baseId, arraySiteId);
    expect(site).toMatchObject({ id: arraySiteId, siteKey: "array", state: "built" });
    expect(await repo.getSite(tx, "b-other", arraySiteId)).toBeNull();

    await repo.markSiteReserved(tx, freeSiteId);
    expect((await repo.getSite(tx, baseId, freeSiteId))?.state).toBe("reserved");

    await repo.markSiteBuilt(tx, freeSiteId, "facility:solar_array_unit@1");
    expect(await repo.getSite(tx, baseId, freeSiteId)).toMatchObject({
      state: "built",
      builtFacilityRef: "facility:solar_array_unit@1"
    });

    await repo.releaseSite(tx, freeSiteId);
    expect(await repo.getSite(tx, baseId, freeSiteId)).toMatchObject({
      state: "free",
      builtFacilityRef: null
    });
  });
});
