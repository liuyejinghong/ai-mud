// M14-Q 遗留补齐：协作闭环 + 决策审计落库（真 PG）。
// 验证：注入写入口 → decision_records 真库落行（mode/provider/selected 可回查）。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DecisionGateway,
  type DecisionAuditRow
} from "../../../modules/ai/decision-gateway.js";

const DATABASE_URL = process.env.DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

let adminPool: pg.Pool;
let client: pg.PoolClient;
const dbName = `ai_mud_vitest_m14_${process.pid}_${randomUUID().slice(0, 8)}`;

const here = dirname(fileURLToPath(import.meta.url));
function journalPath(): string {
  return join(here, "../../../../drizzle/meta/_journal.json");
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  adminPool = new pg.Pool({ connectionString: DATABASE_URL });
  const adminClient = await adminPool.connect();
  await adminClient.query(`CREATE DATABASE "${dbName}"`);
  adminClient.release();

  const migPool = new pg.Pool({
    connectionString: `${DATABASE_URL.substring(0, DATABASE_URL.lastIndexOf("/") + 1)}${dbName}`
  });
  const migClient = await migPool.connect();
  const journal = JSON.parse(readFileSync(journalPath(), "utf8"));
  for (const entry of journal.entries) {
    const sqlFile = readFileSync(
      join(here, `../../../../drizzle/${entry.tag}.sql`),
      "utf8"
    );
    for (const statement of sqlFile.split("--> statement-breakpoint")) {
      await migClient.query(statement);
    }
  }
  migClient.release();

  // 建立长连接（挂到目标库），供本文件全部查询使用；migPool 不 end（client 还连着它）。
  client = await migPool.connect();
});

afterAll(async () => {
  if (!DATABASE_URL || !client) return;
  await client.release();
  const adminPool2 = new pg.Pool({ connectionString: DATABASE_URL });
  const adminClient = await adminPool2.connect();
  await adminClient.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  adminClient.release();
  await adminPool2.end();
});

d("M14 cooperation shadow chain (real PostgreSQL)", () => {
  it("gateway audit row lands in decision_records via injected writer", async () => {
    if (!client) return;
    // 网关审计注入写入口 → 真库落行（覆盖 M14-A 单测的假捕获路径）。
    const rows: DecisionAuditRow[] = [];
    const gateway = new DecisionGateway({
      recordAudit: async (row) => {
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
