#!/usr/bin/env node
// 汇总证据包：manifest.json（机器可读）+ summary.md（人读/作业摘要）。
// 只聚合已经落盘的文件与运行上下文，不生成任何"预期结果"。
// 聚合逻辑在 buildRunSummary（纯函数，node --test 有合成输入回归，属基础设施单元测试，
// 其结果不代表真实游戏运行）；本入口只负责 IO 与环境上下文。
// 用法：node scripts/playtest/collect-evidence.mjs （在仓库根运行，GITHUB_* 由 Actions 提供）
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const EVIDENCE_DIR = process.env.PLAYTEST_EVIDENCE_DIR ?? "tests/playtest/evidence";
const REPOSITORY = process.env.GITHUB_REPOSITORY ?? "liuyejinghong/ai-mud";
const RUN_ID = process.env.GITHUB_RUN_ID ?? "local";
const RUN_ATTEMPT = process.env.GITHUB_RUN_ATTEMPT ?? "1";
const RUN_URL = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${REPOSITORY}/actions/runs/${RUN_ID}`;
const ARTIFACT_NAME = `playtest-evidence-${RUN_ID}-attempt${RUN_ATTEMPT}`;

// 运行必须通过的就绪检查名（与 workflow 的 wait-for 步骤一一对应）。
const REQUIRED_SELFCHECK = ["postgres", "backend", "frontend"];

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
    pr_head_branch: pr.head.ref,
    base_branch: pr.base.ref,
    base_branch_sha: pr.base.sha,
    // pull_request 事件里 GITHUB_SHA 是 GitHub 生成的 merge commit；
    // 实际运行的代码 = merge commit（含 base 分支内容 + 本 PR 改动）。
    merge_commit_sha: process.env.GITHUB_SHA
  };
}

// 清单索引 = 上传内容的安全子集规则：跳过隐藏文件（upload-artifact 默认也不上传，
// 不为单个文件开启隐藏文件上传，避免夹带 .env 等），跳过清单自身（manifest/summary 是
// 索引本体，纳入索引会造成自引用校验）。
export function isIndexableEvidenceFile(relativePath) {
  if (relativePath === "manifest.json" || relativePath === "summary.md") return false;
  return !relativePath.split("/").some((segment) => segment.startsWith("."));
}

function walkFiles(dir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(full, rel));
    else if (isIndexableEvidenceFile(rel)) files.push({ path: rel, bytes: statSync(full).size });
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

// ---- 纯聚合（可单测）----
// 输入：
//   selfcheck: selfcheck.json 行数组（{check,name,ok,kind,detail}）
//   runMetas:  run-meta-*.json 数组（含 business_checks: BusinessCheckRecord[] 与 runtime）
//   steps:     steps.jsonl 行数组
//   context:   { repository, runId, runAttempt, runNumber, eventName, runUrl, artifactName,
//                prContext, toolVersions, playwrightVersion, productBaselineSha, baseUrl,
//                checkoutSha, checkoutBranch, evidenceFiles }
export function buildRunSummary({ selfcheck = [], runMetas = [], steps = [], context }) {
  const absentSelfcheck = REQUIRED_SELFCHECK.filter(
    (name) => !selfcheck.some((entry) => entry.name === name)
  );
  const selfcheckFailures = selfcheck.filter((entry) => entry.ok === false);
  const selfcheckOk = selfcheckFailures.length === 0 && absentSelfcheck.length === 0;

  const scenarios = runMetas.map((meta) => {
    const checks = Array.isArray(meta.business_checks) ? meta.business_checks : [];
    const blocked = checks.filter((c) => c.result !== "effective");
    return {
      scenario: meta.scenario,
      file: meta.file,
      status: meta.status,
      steps_total: meta.steps_total,
      last_completed_step: meta.last_completed_step,
      started_at: meta.started_at,
      finished_at: meta.finished_at,
      // 业务状态三值：执行完且全部生效=effective；有非 effective=blocked；未声明任何业务检查=none_observed。
      business_status: blocked.length > 0 ? "blocked" : checks.length > 0 ? "effective" : "none_observed",
      business_checks: checks,
      ineffective_checks: blocked,
      runtime: meta.runtime ?? null,
      notes: meta.notes ?? {}
    };
  });

  const game_blocked_candidates = scenarios.filter((s) => s.business_status === "blocked");

  let status;
  if (runMetas.length === 0) {
    status =
      selfcheckFailures.length > 0 || absentSelfcheck.length > 0
        ? "BLOCKED_BEFORE_TESTS"
        : "NO_SCENARIO_RAN";
  } else if (scenarios.some((s) => s.status !== "passed")) {
    status = "SMOKE_FAILED";
  } else if (game_blocked_candidates.length > 0) {
    // 场景执行完但业务动作未生效：明确标 GAME_BLOCKED，不得用 PASSED 掩盖。
    status = "GAME_BLOCKED";
  } else if (!selfcheckOk) {
    status = "SMOKE_INCONCLUSIVE";
  } else {
    status = "SMOKE_PASSED";
  }

  const productBaseline = context.productBaselineSha
    ? { sha: context.productBaselineSha, source: "PRODUCT_BASELINE_SHA（workflow 输入，冻结的产品基线）" }
    : {
        sha: "UNKNOWN",
        source: `本次运行未提供 PRODUCT_BASELINE_SHA；PR base 分支（${context.prContext?.base_branch ?? "n/a"}）只是堆叠目标，不构成产品基线证据`
      };

  const manifest = {
    schema_version: "2.0",
    generated_at: new Date().toISOString(),
    status,
    status_vocabulary: {
      SMOKE_PASSED: "场景全部通过且业务检查全部生效、就绪检查齐全",
      GAME_BLOCKED: "场景执行完但业务动作未生效（游戏问题候选，保留证据）",
      SMOKE_FAILED: "场景断言失败",
      SMOKE_INCONCLUSIVE: "场景通过但必要就绪记录缺失，不判定成功",
      BLOCKED_BEFORE_TESTS: "环境未就绪，场景未运行",
      NO_SCENARIO_RAN: "环境就绪但没有任何场景运行"
    },
    repository: context.repository,
    run: {
      run_id: context.runId,
      run_attempt: context.runAttempt,
      run_number: context.runNumber,
      event_name: context.eventName,
      run_url: context.runUrl,
      artifact_name: context.artifactName,
      artifact_note: "artifact_id 与过期时间见作业摘要；有效期 retention-days=7"
    },
    versions: {
      actual_checkout: {
        sha: context.checkoutSha,
        branch: context.checkoutBranch,
        note: "实际被运行的代码以此为准（pull_request 事件下即 GitHub 生成的 merge commit）"
      },
      merge_commit_sha: context.prContext?.merge_commit_sha ?? null,
      pull_request: context.prContext?.pr_number
        ? {
            number: context.prContext.pr_number,
            head_sha: context.prContext.pr_head_sha,
            head_branch: context.prContext.pr_head_branch,
            base_sha: context.prContext.base_branch_sha,
            base_branch: context.prContext.base_branch
          }
        : null,
      product_baseline: productBaseline,
      note: "四元组各表其义：actual checkout=运行事实；PR head=场景/基础设施/产品修复提交；PR base=堆叠目标分支快照；product baseline=冻结比较起点，未知写 UNKNOWN"
    },
    scenarios,
    steps_total: steps.length,
    last_completed_step: steps.filter((s) => s.result === "ok").at(-1)?.step_id ?? null,
    environment: {
      node: context.toolVersions.node ?? process.version,
      pnpm: context.toolVersions.pnpm ?? null,
      playwright: context.playwrightVersion ?? null,
      database: selfcheck.find((entry) => entry.check === "pg")?.detail ?? null,
      base_url: context.baseUrl,
      // configured_default 仅为配置声明；每场景实际视口/浏览器版本见 scenarios[].runtime。
      configured_default: {
        viewport: "1440x900",
        timezone: "Asia/Shanghai",
        workers: 1,
        retries: 0,
        trace: "on（成功与失败都录制）"
      }
    },
    selfcheck: {
      required: REQUIRED_SELFCHECK,
      entries: selfcheck,
      ok: selfcheckOk,
      blockers: [
        ...selfcheckFailures.map((e) => ({ check: e.name, kind: e.kind, detail: e.detail })),
        ...absentSelfcheck.map((name) => ({ check: name, kind: "missing_selfcheck", detail: "必要就绪记录缺失" }))
      ]
    },
    game_blocked_candidates,
    timing: {
      started_at: runMetas[0]?.started_at ?? null,
      finished_at: runMetas.at(-1)?.finished_at ?? null,
      note: "以上为墙钟时间。游戏内为独立模拟时间（simTime），只在页面文本/截图中出现；脚本等待时长不是玩家体验指标。"
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
      "SERVER_HOST=127.0.0.1，无对外暴露地址；使用作业内引导的隔离测试管理员，无线上账号"
    ],
    privacy: {
      redaction: "steps/console/network 中 password/secret/token/authorization/cookie/csrf 已掩码；CSRF/Cookie 值不写入摘要",
      traces: "trace 含一次性隔离账号的表单内容；该账号与数据库随作业销毁，7 天后 artifact 过期",
      excluded: "不含 .env、生产凭据、数据库转储、持久化会话文件",
      index_note: "manifest.json 与 summary.md 是清单本体，不纳入 evidence_files；隐藏文件不入索引（与上传规则一致）"
    },
    evidence_files: context.evidenceFiles ?? []
  };

  const summaryMd = renderSummaryMarkdown(manifest);
  return { manifest, summaryMd };
}

function renderSummaryMarkdown(manifest) {
  const pr = manifest.versions.pull_request;
  const scenarioLines = manifest.scenarios
    .map(
      (s) =>
        `| ${s.scenario} | ${s.status} | ${s.business_status} | ${s.steps_total} | ${s.last_completed_step ?? "-"} | ${
          s.runtime
            ? `${s.runtime.viewport_final?.width}×${s.runtime.viewport_final?.height} @ ${s.runtime.browser_name} ${s.runtime.browser_version ?? "?"}`
            : "-"
        } |`
    )
    .join("\n");

  const statusLine =
    manifest.status === "SMOKE_PASSED"
      ? `✅ **${manifest.status}**`
      : manifest.status === "GAME_BLOCKED"
        ? `⛔ **${manifest.status}**（场景执行完，但业务动作未生效——游戏问题候选，见下）`
        : `❌ **${manifest.status}**`;

  return `# 浏览器验收运行摘要

**状态：${statusLine}** · run [${manifest.run.run_id}/attempt ${manifest.run.run_attempt}](${manifest.run.run_url}) · artifact \`${manifest.run.artifact_name}\`（保留 7 天）

- 仓库 \`${manifest.repository}\`${pr ? ` · PR #${pr.number}（head \`${pr.head_sha.slice(0, 12)}\` @ ${pr.head_branch}，base ${pr.base_branch}）` : ""}
- 实际运行 checkout：\`${manifest.versions.actual_checkout.sha}\`（${manifest.versions.actual_checkout.branch ?? "-"}）
- 产品基线：\`${manifest.versions.product_baseline.sha}\`（${manifest.versions.product_baseline.source}）
- 环境：node ${manifest.environment.node} · ${manifest.environment.playwright ?? "playwright ?"} · DB ${manifest.environment.database ?? "?"}
- 视口：按场景实际记录（配置默认 ${manifest.environment.configured_default.viewport}，见下表 runtime 列）
- 模型调用：关闭（AI_PROVIDER=template / AI_NPC_DIALOGUE_ENABLED=false / TYPE_SAFE_DECISION_MODE=off）
- 数据隔离：一次性 PG 容器 + 一次性试玩账号；每轮从新档开始

## 就绪自检（必需：${manifest.selfcheck.required.join(" / ")}）
${manifest.selfcheck.entries.length === 0 ? "（未记录）" : manifest.selfcheck.entries.map((e) => `- ${e.ok === true ? "✅" : "❌"} ${e.name}: ${e.kind} — ${e.detail}`).join("\n")}
${manifest.selfcheck.blockers.some((b) => b.kind === "missing_selfcheck") ? `- ❌ 缺失就绪记录：${manifest.selfcheck.blockers.filter((b) => b.kind === "missing_selfcheck").map((b) => b.check).join("、")}` : ""}

## 场景（business_status：effective=业务生效；blocked=业务未生效；none_observed=未声明业务检查）
| 场景 | 结果 | 业务 | 步骤数 | 最后完成步骤 | 实际视口@浏览器 |
|---|---|---|---|---|---|
${scenarioLines || "| （无场景运行）| - | - | - | - | - |"}

${
  manifest.game_blocked_candidates.length > 0
    ? `## ⛔ 业务未生效（GAME_BLOCKED 候选，需评审结合证据判断）\n${manifest.game_blocked_candidates
        .map(
          (s) =>
            `- **${s.scenario}**：\n${s.ineffective_checks
              .map((c) => `  - \`${c.check}\` → ${c.result}${c.detail ? `（${c.detail}）` : ""}`)
              .join("\n")}`
        )
        .join("\n")}\n`
    : ""
}
## 证据索引
- \`manifest.json\` — 全量清单（${manifest.evidence_files.length} 个索引文件；清单自身不入索引）
- \`steps.jsonl\` — 每步操作意图/前后状态/截图
- \`console.jsonl\` · \`network.jsonl\` — 控制台与网络（含 ≥400 响应标记）
- \`screenshots/\` · \`test-results/\`（trace） · \`playwright-report/\`
- \`server.log\` · \`web.log\` — 服务端/前端进程日志
- 下载：\`gh run download ${manifest.run.run_id} -n ${manifest.run.artifact_name} -R ${manifest.repository}\`

时间口径：墙钟时间；游戏内 simTime 另见页面文本。脚本等待不代表玩家体验。
`;
}

// ---- IO 入口 ----
const selfcheck = readJsonl(join(EVIDENCE_DIR, "selfcheck.json"));
const runMetas = existsSync(EVIDENCE_DIR)
  ? readdirSync(EVIDENCE_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.startsWith("run-meta-") && e.name.endsWith(".json"))
      .map((e) => JSON.parse(readFileSync(join(EVIDENCE_DIR, e.name), "utf8")))
  : [];
const steps = readJsonl(join(EVIDENCE_DIR, "steps.jsonl"));
const toolVersions = readKeyValues(join(EVIDENCE_DIR, "tool-versions.txt"));
const prContext = readPrContext();
const evidenceFiles = existsSync(EVIDENCE_DIR) ? walkFiles(EVIDENCE_DIR) : [];
const playwrightVersion = existsSync(join(EVIDENCE_DIR, "playwright-version.txt"))
  ? readFileSync(join(EVIDENCE_DIR, "playwright-version.txt"), "utf8").trim()
  : null;

const { manifest, summaryMd } = buildRunSummary({
  selfcheck,
  runMetas,
  steps,
  context: {
    repository: REPOSITORY,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    runNumber: process.env.GITHUB_RUN_NUMBER ?? null,
    eventName: process.env.GITHUB_EVENT_NAME ?? "local",
    runUrl: RUN_URL,
    artifactName: ARTIFACT_NAME,
    prContext,
    toolVersions,
    playwrightVersion,
    productBaselineSha: process.env.PRODUCT_BASELINE_SHA || "",
    baseUrl: process.env.PLAYTEST_BASE_URL ?? "http://127.0.0.1:4173",
    checkoutSha: toolVersions.git_checkout ?? gitSha("rev-parse HEAD"),
    checkoutBranch: gitSha("rev-parse --abbrev-ref HEAD"),
    evidenceFiles
  }
});

writeFileSync(join(EVIDENCE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(EVIDENCE_DIR, "summary.md"), summaryMd);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMd);
}

console.log(`[collect-evidence] status=${manifest.status} scenarios=${runMetas.length} steps=${steps.length} files=${evidenceFiles.length}`);
