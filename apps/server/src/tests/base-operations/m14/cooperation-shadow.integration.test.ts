// M14-Q 遗留补齐：协作闭环 + 决策审计落库（真 PG）。
// 验证：注入写入口 → decision_records 真库落行（mode/provider/selected 可回查）。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { createBaseOperations } from "../../../application/base/composition.js";
import { loadEnv } from "../../../config/env.js";
import * as schema from "../../../db/schema.js";
import {
  DecisionGateway,
  type DecisionAuditRow
} from "../../../modules/ai/decision-gateway.js";

const DATABASE_URL = process.env.DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

let adminPool: pg.Pool;
let migPool: pg.Pool;
let client: pg.PoolClient;
const dbName = `ai_mud_vitest_m14_${process.pid}_${randomUUID().slice(0, 8)}`;

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
  // 全部迁移拼接为单次多语句查询：CI 上逐条往返会超出默认 10s 钩子超时。
  const journal = JSON.parse(readFileSync(journalPath(), "utf8"));
  const allSql = (journal.entries as Array<{ tag: string }>)
    .map((entry) =>
      readFileSync(join(here, `../../../../drizzle/${entry.tag}.sql`), "utf8")
    )
    .join("\n--> statement-breakpoint\n");
  await migClient.query(allSql);
  migClient.release();

  // 建立长连接（挂到目标库），供本文件全部查询使用；migPool 在 afterAll 统一收口。
    client = await migPool.connect();
  },
  120_000 // CI 上顺序执行全部 33 个迁移，远超默认 10s 钩子超时
);

afterAll(async () => {
  if (!DATABASE_URL || !client) return;
  // 归还长连接 → 关池 → 再 FORCE 删除（顺序错了 pool.end 会等未归还连接）。
  await client.release();
  await migPool.end();
  const adminPool = new pg.Pool({ connectionString: DATABASE_URL });
  const adminClient = await adminPool.connect();
  await adminClient.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  adminClient.release();
  await adminPool.end();
});

d("M14 cooperation shadow chain (real PostgreSQL)", () => {
  it("C07: 结算事务内的机器人更新对协作检测可见", async () => {
    if (!migPool) return;
    const db = drizzle(migPool, { schema });
    const now = new Date();
    const accountId = randomUUID();
    const baseId = randomUUID();
    const siteA = randomUUID();
    const siteB = randomUUID();
    const projectA = randomUUID();
    const projectB = randomUUID();
    const deviceId = randomUUID();
    const operatorId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(schema.accounts).values({ id: accountId, email: `c07-${accountId}@example.invalid`, passwordHash: "x" });
      await tx.insert(schema.bases).values({
        id: baseId, accountId, name: "C07 事务基地", contentRelease: "yudian-base-0",
        timeMode: "running", simTime: new Date("2026-09-01T10:00:00Z"),
        lastAdvancedAt: new Date(now.getTime() - 60_000)
      });
      await tx.insert(schema.baseControlLeases).values({
        baseId, leaseToken: "c07", leaseUntil: new Date(now.getTime() + 300_000)
      });
      await tx.insert(schema.basePowerState).values({
        baseId, generationWPeak: 15_000, storageWh: 100_000,
        storageCapacityWh: 200_000, lastLoadW: 0
      });
      await tx.insert(schema.baseSites).values([
        { id: siteA, baseId, siteKey: "site_a", state: "reserved" },
        { id: siteB, baseId, siteKey: "site_b", state: "reserved" }
      ]);
      await tx.insert(schema.baseProjects).values([
        { id: projectA, baseId, siteId: siteA, projectDefId: "install-solar-array", templateRevision: 1, status: "active", reservedInputs: [] },
        { id: projectB, baseId, siteId: siteB, projectDefId: "install-solar-array", templateRevision: 1, status: "active", reservedInputs: [] }
      ]);
      await tx.insert(schema.baseProjectSteps).values([
        { projectId: projectA, stepIndex: 0, kind: "site_clearing", groupId: "engineering", status: "ready", workRequired: 40 },
        { projectId: projectB, stepIndex: 0, kind: "commissioning", groupId: "survey", status: "ready", workRequired: 20 }
      ]);
      await tx.insert(schema.baseDevices).values({
        id: deviceId, baseId, deviceDefId: "yd-e1", templateRevision: 1,
        sourceOperation: `c07-${deviceId}`
      });
      await tx.insert(schema.robotOperators).values({
        id: operatorId, deviceId, baseId, groupId: "engineering",
        batteryWh: 30_000, batteryCapacityWh: 30_000, status: "idle"
      });
    });

    const ops = createBaseOperations({
      db,
      config: loadEnv({ DATABASE_URL: "postgres://localhost/test", SESSION_SECRET: "x".repeat(32), NODE_ENV: "test" })
    });
    await db.transaction(async (tx) => {
      expect(await ops.settlement.settleBases(tx, now)).toBe(1);
      const insideRobot = await tx.select().from(schema.robotOperators).where(eq(schema.robotOperators.id, operatorId));
      expect(insideRobot[0]?.status).toBe("working");
      const outsideRobot = await db.select().from(schema.robotOperators).where(eq(schema.robotOperators.id, operatorId));
      expect(outsideRobot[0]?.status).toBe("idle");
    });

    const requests = await db.select().from(schema.cooperationRequests).where(eq(schema.cooperationRequests.baseId, baseId));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ projectId: projectB, stepIndex: 0, status: "pending" });
  });

  it("gateway audit row lands in decision_records via injected writer", async () => {
    if (!client) return;
    // 网关审计注入写入口 → 真库落行（覆盖 M14-A 单测的假捕获路径）。
    const rows: DecisionAuditRow[] = [];
    const gateway = new DecisionGateway({
      recordAudit: async (_tx, row) => {
        rows.push(row);
        await client.query(
          `INSERT INTO decision_records (decision_id, purpose, mode, provider, plan_revision, question, candidates, selected_candidate_id, latency_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            row.decisionId,
            row.purpose,
            row.mode,
            row.provider,
            row.planRevision,
            row.question,
            JSON.stringify(row.candidates),
            row.selectedCandidateId,
            row.latencyMs
          ]
        );
      }
    });

    const outcome = await gateway.decide({} as never, {
      decisionId: `dec-${randomUUID()}`,
      purpose: "transport_assistance",
      baseId: "00000000-0000-0000-0000-000000000001",
      epoch: 1,
      planRevision: 1,
      question: "谁支援运输？",
      candidates: [{ candidateId: "op-a", summary: "望山-1", score: 0.5 }],
      deadlineMs: 2000
    });

    expect(outcome.selectedCandidateId).toBe("op-a");
    const check = await client.query(`SELECT mode, provider, selected_candidate_id FROM decision_records`);
    expect(check.rows).toHaveLength(1);
    expect(check.rows[0]).toMatchObject({
      mode: "rule",
      provider: "rule",
      selected_candidate_id: "op-a"
    });
  });
});
