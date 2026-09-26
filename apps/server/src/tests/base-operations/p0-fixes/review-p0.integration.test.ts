// 2026-09-22 评审 P0 修复回归（真 PG）：
//   B002 制造工单进度列必须容纳小数（结算按 tick 累加小数工作量，整数列曾致基地结算
//   每 tick 回滚、模拟静默冻结——评审报告 B002）。
//   B001 决策审计必须随调用方事务落库（composition 曾用池连接写 decision_records，
//   与结算事务跨连接自死锁→全站瘫痪——评审报告 B001）。本测试锁不变量：
//   事务提交前审计行对外部连接不可见（池连接即时提交的旧写法在此判负）。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { DecisionGateway } from "../../../modules/ai/decision-gateway.js";
import { ManufacturingRepository } from "../../../modules/industry/manufacturing.repository.js";
import * as schema from "../../../db/schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

let adminPool: pg.Pool;
let migPool: pg.Pool;
const dbName = `ai_mud_vitest_p0_${process.pid}_${randomUUID().slice(0, 8)}`;
let seededBaseId = "";
let seededAccountId = "";

const here = dirname(fileURLToPath(import.meta.url));
function journalPath(): string {
  return join(here, "../../../../drizzle/meta/_journal.json");
}

beforeAll(
  async () => {
    if (!DATABASE_URL) return;
    adminPool = new pg.Pool({ connectionString: DATABASE_URL });
    const adminClient = await adminPool.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}"`);
    adminClient.release();

    migPool = new pg.Pool({
      connectionString: `${DATABASE_URL.substring(0, DATABASE_URL.lastIndexOf("/") + 1)}${dbName}`
    });
    const migClient = await migPool.connect();
    const journal = JSON.parse(readFileSync(journalPath(), "utf8"));
    const allSql = (journal.entries as Array<{ tag: string }>)
      .map((entry) => readFileSync(join(here, `../../../../drizzle/${entry.tag}.sql`), "utf8"))
      .join("\n--> statement-breakpoint\n");
    await migClient.query(allSql);
    migClient.release();

    // 共用种子：账号 + 基地（decision_records.base_id / 工单外键都指它）。
    const db = drizzle(migPool, { schema });
    seededBaseId = randomUUID();
    seededAccountId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(schema.accounts).values({
        id: seededAccountId,
        email: `p0-seed-${randomUUID()}@example.invalid`,
        passwordHash: "x"
      });
      await tx.insert(schema.bases).values({
        id: seededBaseId,
        accountId: seededAccountId,
        name: "P0 回归基地",
        contentRelease: "yudian-base-0"
      });
    });
  },
  120_000
);

afterAll(async () => {
  if (!DATABASE_URL || !migPool) return;
  await migPool.end();
  const cleanup = new pg.Pool({ connectionString: DATABASE_URL });
  const c = await cleanup.connect();
  await c.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  c.release();
  await cleanup.end();
});

d("P0 修复回归（真 PostgreSQL）", () => {
  it("B002: 制造工单进度接受小数并原样保存（不做静默取整）", async () => {
    if (!migPool) return;
    const db = drizzle(migPool, { schema });

    // 种子：制造工单（账号/基地在 beforeAll 共用种子）。
    const jobId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(schema.baseManufacturingJobs).values({
        id: jobId,
        baseId: seededBaseId,
        recipeDefId: "manufacture-yd-h1",
        recipeRevision: 1,
        status: "active",
        outputsPlanned: 1,
        outputsDone: 0,
        currentUnitWorkDone: 0,
        reservedInputs: []
      });
    });

    const repo = new ManufacturingRepository(db);
    const FRACTION = 0.08; // 评审实测：单 tick 折算工作量 ≈0.08（整数列曾 22P02 崩溃）
    await db.transaction(async (tx) => {
      await repo.saveJobProgress(tx, {
        jobId,
        status: "active",
        outputsDone: 0,
        currentUnitWorkDone: FRACTION,
        blockedReason: null,
        reservedInputs: [],
        completedAt: null
      });
    });

    const rows = await db
      .select()
      .from(schema.baseManufacturingJobs)
      .where(eq(schema.baseManufacturingJobs.id, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.currentUnitWorkDone).toBeCloseTo(FRACTION, 6);
  });

  it("B001: 决策审计随调用方事务落库（提交前外部连接不可见）", async () => {
    if (!migPool) return;
    const db = drizzle(migPool, { schema });

    // 与 composition.ts 相同形状的注入写：审计行走调用方事务（禁止池连接）。
    const gateway = new DecisionGateway({
      recordAudit: async (auditTx, row) => {
        await (auditTx as typeof db).insert(schema.decisionRecords).values({
          decisionId: row.decisionId,
          purpose: row.purpose,
          mode: row.mode,
          provider: row.provider,
          baseId: row.baseId,
          planRevision: row.planRevision,
          question: row.question,
          candidates: row.candidates as never,
          selectedCandidateId: row.selectedCandidateId,
          latencyMs: row.latencyMs
        });
      }
    });

    const decisionId = `p0-${randomUUID()}`;
    const outside = await migPool.connect();
    try {
      await db.transaction(async (tx) => {
        await gateway.decide(tx, {
          decisionId,
          purpose: "transport_assistance",
          baseId: seededBaseId,
          epoch: 1,
          planRevision: 1,
          question: "谁支援运输？",
          candidates: [{ candidateId: "op-a", summary: "望山-1", score: 0.5 }],
          deadlineMs: 2000
        });

        // 事务内可见（同连接）；
        const inside = await tx
          .select()
          .from(schema.decisionRecords)
          .where(eq(schema.decisionRecords.decisionId, decisionId));
        expect(inside).toHaveLength(1);
        // 未提交对外部连接不可见——池连接即时提交的旧写法在这里 = 1 → 判负。
        const beforeCommit = await outside.query(`SELECT count(*)::int AS n FROM decision_records`);
        expect(beforeCommit.rows[0]?.n).toBe(0);
      });
      // 提交后对外可见。
      const afterCommit = await outside.query(`SELECT count(*)::int AS n FROM decision_records`);
      expect(afterCommit.rows[0]?.n).toBe(1);
    } finally {
      outside.release();
    }
  });
});
