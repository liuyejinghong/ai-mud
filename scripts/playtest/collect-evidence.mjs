#!/usr/bin/env node
// 汇总证据包：manifest.json（机器可读）+ summary.md（人读/作业摘要）。
// 只聚合已经落盘的文件与运行上下文，不生成任何"预期结果"。
// 用法：node scripts/playtest/collect-evidence.mjs （在仓库根运行，GITHUB_* 由 Actions 提供）
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, relative } from "node:path";

const EVIDENCE_DIR = process.env.PLAYTEST_EVIDENCE_DIR ?? "tests/playtest/evidence";
const REPOSITORY = process.env.GITHUB_REPOSITORY ?? "liuyejinghong/ai-mud";
const RUN_ID = process.env.GITHUB_RUN_ID ?? "local";
const RUN_ATTEMPT = process.env.GITHUB_RUN_ATTEMPT ?? "1";
const RUN_URL = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${REPOSITORY}/actions/runs/${RUN_ID}`;
const ARTIFACT_NAME = `playtest-evidence-${RUN_ID}-attempt${RUN_ATTEMPT}`;

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { unparsable: line.slice(0, 200) };
      }
    });
}

function gitSha(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function readPrContext() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return {};
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pr = event.pull_request;
  if (!pr) return {};
  return {
    pr_number: pr.number,
    pr_head_sha: pr.head.sha,
    base_branch: pr.base.ref,
    base_branch_sha: pr.base.sha,
    // pull_request 事件里 GITHUB_SHA 是 GitHub 生成的 merge commit；
    // 实际运行的代码 = merge commit（含 base 分支上的游戏实现 + 本 PR 改动）。
    merge_commit_sha: process.env.GITHUB_SHA
  };
}

function walkFiles(dir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(full, rel));
    else files.push({ path: rel, bytes: statSync(full).size });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function readKeyValues(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// ---- 聚合 ----
const selfcheck = readJsonl(join(EVIDENCE_DIR, "selfcheck.json"));
const runMetas = existsSync(EVIDENCE_DIR)
  ? readdirSync(EVIDENCE_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.startsWith("run-meta-") && e.name.endsWith(".json"))
      .map((e) => JSON.parse(readFileSync(join(EVIDENCE_DIR, e.name), "utf8")))
  : [];
const steps = readJsonl(join(EVIDENCE_DIR, "steps.jsonl"));
const toolVersions = readKeyValues(join(EVIDENCE_DIR, "tool-versions.txt"));
const prContext = readPrContext();

const selfcheckFailures = selfcheck.filter((entry) => entry.ok === false);
const failedScenarios = runMetas.filter((meta) => meta.status !== "passed");
const game_blocked_candidates = runMetas.filter((meta) =>
  Object.entries(meta.business_checks ?? {}).some(([key, value]) => key.endsWith("_result") && value === "no_change_after_click")
);

let status;
if (runMetas.length === 0) {
  status = selfcheckFailures.length > 0 ? "BLOCKED_BEFORE_TESTS" : "NO_SCENARIO_RAN";
} else if (failedScenarios.length > 0) {
  status = "SMOKE_FAILED";
} else {
  status = "SMOKE_PASSED";
}

const evidenceFiles = existsSync(EVIDENCE_DIR) ? walkFiles(EVIDENCE_DIR) : [];

const manifest = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  status,
  repository: REPOSITORY,
  run: {
    run_id: RUN_ID,
    run_attempt: RUN_ATTEMPT,
    run_number: process.env.GITHUB_RUN_NUMBER ?? null,
    event_name: process.env.GITHUB_EVENT_NAME ?? "local",
    run_url: RUN_URL,
    artifact_name: ARTIFACT_NAME,
    artifact_note: "artifact_id 与过期时间见作业摘要（artifact 上传后才能取到 id）；有效期 retention-days=7"
  },
  pull_request: prContext.pr_number
    ? {
        number: prContext.pr_number,
        head_sha: prContext.pr_head_sha,
        base_branch: prContext.base_branch,
        base_branch_sha: prContext.base_branch_sha
      }
    : null,
  versions: {
    checkout_sha: toolVersions.git_checkout ?? gitSha("rev-parse HEAD"),
    // 三个提交的区分：monorepo 内游戏实现/基础设施/场景随同一提交走。
    // merge_commit 仅存在于 pull_request 事件；checkout_sha 是实际被运行的代码。
    merge_commit_sha: prContext.merge_commit_sha ?? null,
    game_implementation_base_sha: prContext.base_branch_sha ?? null,
    infra_and_scenario_head_sha: prContext.pr_head_sha ?? toolVersions.git_checkout ?? null,
    github_context_sha: toolVersions.github_context_sha ?? null,
    note: "游戏实现基线 = base 分支（v0.12.0-base-operations）；基础设施与场景提交 = PR head"
  },
  scenarios: runMetas.map((meta) => ({
    scenario: meta.scenario,
    file: meta.file,
    status: meta.status,
    steps_total: meta.steps_total,
    last_completed_step: meta.last_completed_step,
    started_at: meta.started_at,
    finished_at: meta.finished_at,
    business_checks: meta.business_checks ?? {}
  })),
  steps_total: steps.length,
  last_completed_step: steps.filter((s) => s.result === "ok").at(-1)?.step_id ?? null,
  environment: {
    node: toolVersions.node ?? process.version,
    pnpm: toolVersions.pnpm ?? null,
    playwright: existsSync(join(EVIDENCE_DIR, "playwright-version.txt"))
      ? readFileSync(join(EVIDENCE_DIR, "playwright-version.txt"), "utf8").trim()
      : null,
    database: selfcheck.find((entry) => entry.check === "pg")?.detail ?? null,
    base_url: process.env.PLAYTEST_BASE_URL ?? "http://127.0.0.1:4173",
    viewport: "1440x900",
    timezone: "Asia/Shanghai",
    workers: 1,
    retries: 0,
    trace: "on（成功与失败都录制）"
  },
  selfcheck: {
    entries: selfcheck,
    ok: selfcheckFailures.length === 0,
    blockers: selfcheckFailures
  },
  game_blocked_candidates,
  timing: {
    started_at: runMetas[0]?.started_at ?? null,
    finished_at: runMetas.at(-1)?.finished_at ?? null,
    note: "以上为墙钟时间。游戏内为独立模拟时间（simTime），只在页面文本/截图中出现（如「基地时间 14:23 · 昼间」）；脚本等待时长不是玩家体验指标。"
  },
  model_and_cost: {
    ai_provider: "template（规则模板，非付费模型）",
    ai_npc_dialogue_enabled: false,
    type_safe_decision_mode: "off",
    note: "本次运行没有真实付费模型调用"
  },
  differs_from_production: [
    "无 docker/nginx：前端由 scripts/playtest/serve-web.mjs 以相同路径规则（^/(auth|base|admin|health) 反代，其余 SPA 回退）服务构建产物",
    "数据库为一次性 service 容器（postgres:16-alpine，每作业新建，运行结束销毁），非线上持久卷",
    "SESSION_COOKIE_SECURE=false（纯 HTTP 本地回环），与 VPS 内测一致、与未来 TLS 部署不同",
    "PLAYTEST_REGISTRATION_ENABLED=true（评审需要开放试玩注册）",
    "SERVER_HOST=127.0.0.1，无对外暴露地址；无邀请码/管理引导账号"
  ],
  privacy: {
    redaction: "steps/console/network 中 password/secret/token/authorization/cookie/csrf 已掩码",
    traces: "trace 含一次性隔离账号的表单内容；该账号与数据库随作业销毁，7 天后 artifact 过期",
    excluded: "不含 .env、生产凭据、数据库转储、持久化会话文件"
  },
  evidence_files: evidenceFiles
};

writeFileSync(join(EVIDENCE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const scenarioLines = manifest.scenarios
  .map(
    (s) =>
      `| ${s.scenario} | ${s.status} | ${s.steps_total} | ${s.last_completed_step ?? "-"} | ${Object.entries(
        s.business_checks
      )
        .map(([k, v]) => `${k}=${v}`)
        .join("、") || "-"} |`
  )
  .join("\n");

const summaryMd = `# 浏览器验收运行摘要

**状态：${status}** · run [${RUN_ID}/attempt ${RUN_ATTEMPT}](${RUN_URL}) · artifact \`${ARTIFACT_NAME}\`（保留 7 天）

- 仓库 \`${REPOSITORY}\`${prContext.pr_number ? ` · PR #${prContext.pr_number}` : ""}
- 实际 checkout：\`${manifest.versions.checkout_sha}\`
${prContext.merge_commit_sha ? `- PR merge commit：\`${prContext.merge_commit_sha}\`（游戏实现基线 ${prContext.base_branch ?? ""} @ \`${prContext.base_branch_sha ?? "?"}\`）` : ""}
- 环境：node ${manifest.environment.node} · ${manifest.environment.playwright ?? "playwright ?"} · DB ${manifest.environment.database ?? "?"} · viewport ${manifest.environment.viewport} · TZ ${manifest.environment.timezone}
- 模型调用：关闭（AI_PROVIDER=template / AI_NPC_DIALOGUE_ENABLED=false / TYPE_SAFE_DECISION_MODE=off）
- 数据隔离：一次性 PG 容器 + 一次性试玩账号；每轮从新档开始

## 就绪自检
${selfcheck.length === 0 ? "（未记录）" : selfcheck.map((e) => `- ${e.ok === true ? "✅" : "❌"} ${e.name}: ${e.kind} — ${e.detail}`).join("\n")}

## 场景
| 场景 | 结果 | 步骤数 | 最后完成步骤 | 业务检查 |
|---|---|---|---|---|
${scenarioLines || "| （无场景运行）| - | - | - | - |"}

${game_blocked_candidates.length > 0 ? `⚠️ 业务操作疑似未生效（GAME_BLOCKED 候选，需评审结合证据判断）：\n${game_blocked_candidates.map((m) => `- ${m.scenario}: ${JSON.stringify(m.business_checks)}`).join("\n")}\n` : ""}
## 证据索引
- \`manifest.json\` — 全量清单与文件索引（${evidenceFiles.length} 个文件）
- \`steps.jsonl\` — 每步操作意图/前后状态/截图
- \`console.jsonl\` · \`network.jsonl\` — 控制台与网络（含 ≥400 响应标记）
- \`screenshots/\` · \`test-results/\`（trace） · \`playwright-report/\`
- \`server.log\` · \`web.log\` — 服务端/前端进程日志
- 下载：\`gh run download ${RUN_ID} -n ${ARTIFACT_NAME} -R ${REPOSITORY}\`

时间口径：墙钟时间；游戏内 simTime 另见页面文本。脚本等待不代表玩家体验。
`;

writeFileSync(join(EVIDENCE_DIR, "summary.md"), summaryMd);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMd);
}

console.log(`[collect-evidence] status=${status} scenarios=${runMetas.length} steps=${steps.length} files=${evidenceFiles.length}`);
