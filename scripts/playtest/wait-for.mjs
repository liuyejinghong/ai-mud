#!/usr/bin/env node
// 就绪检查（不使用固定 sleep）：区分「服务未启动 / 无响应 / HTTP 错误 / 内容不符 / DB 查询失败」，
// 结果追加到 evidence/selfcheck.json，供证据包 manifest 引用。
// 用法：
//   node wait-for.mjs ready --url URL --name backend --body-must-contain '"ok":true' --timeout-ms 60000
//   node wait-for.mjs pg --database-url postgres://... --timeout-ms 30000
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const evidenceDir = process.env.PLAYTEST_EVIDENCE_DIR ?? "tests/playtest/evidence";
// pg 是 @ai-mud/server 的依赖；从仓库根运行时通过 server 包解析，不新增根依赖。
const requireFromServer = createRequire(resolve(process.cwd(), "apps/server/package.json"));

function recordSelfcheck(entry) {
  mkdirSync(evidenceDir, { recursive: true });
  appendFileSync(resolve(evidenceDir, "selfcheck.json"), `${JSON.stringify(entry)}\n`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      args[arg.slice(2).replaceAll("-", "_")] = argv[i + 1] ?? "";
      i += 1;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

async function poll(deadlineMs, attempt) {
  for (;;) {
    const result = await attempt();
    if (result.ok) return result;
    if (Date.now() > deadlineMs) return result;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function checkReady({ url, name, bodyMustContain }) {
  const deadline = Date.now() + 60_000;
  const result = await poll(deadline, async () => {
    const started = new Date().toISOString();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        return { ok: false, kind: `http_error_${response.status}`, detail: `HTTP ${response.status}` };
      }
      const body = await response.text();
      if (bodyMustContain && !body.includes(bodyMustContain)) {
        return { ok: false, kind: "unexpected_content", detail: `body missing ${bodyMustContain}` };
      }
      return { ok: true, kind: "ready", detail: `HTTP 200, body ok (${body.length} bytes)` };
    } catch (error) {
      const cause = error?.cause?.code ?? error?.code ?? error?.name;
      const kind = cause === "ECONNREFUSED" ? "service_not_started" : "no_response";
      return { ok: false, kind, detail: String(cause ?? error) };
    }
  });
  return { check: "ready", name, url, ok: result.ok, kind: result.kind, detail: result.detail, ts: new Date().toISOString() };
}

async function checkPg({ databaseUrl }) {
  const deadline = Date.now() + 30_000;
  const { Client } = requireFromServer("pg");
  const result = await poll(deadline, async () => {
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      const { rows } = await client.query("select version() as version, current_database() as db");
      return { ok: true, kind: "ready", detail: `${rows[0].db}: ${String(rows[0].version).split(" ").slice(0, 2).join(" ")}` };
    } catch (error) {
      return { ok: false, kind: "db_unavailable", detail: String(error?.message ?? error).split("\n")[0] };
    } finally {
      await client.end().catch(() => undefined);
    }
  });
  return { check: "pg", name: "postgres", ok: result.ok, kind: result.kind, detail: result.detail, ts: new Date().toISOString() };
}

const args = parseArgs(process.argv.slice(2));
const entry = args._[0] === "pg"
  ? await checkPg({ databaseUrl: args.database_url })
  : await checkReady({ url: args.url, name: args.name ?? "service", bodyMustContain: args.body_must_contain });

recordSelfcheck(entry);
console.log(`[wait-for] ${entry.name}: ${entry.ok ? "OK" : "FAIL"} (${entry.kind}) — ${entry.detail}`);
if (!entry.ok) process.exit(1);
