// 证据采集器单元回归——基础设施单元测试，全部使用合成输入，
// 不代表任何真实游戏运行证据；真实运行证据只来自 Actions 上的实际跑。
// 运行：node --test scripts/playtest/
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRunSummary, isIndexableEvidenceFile } from "./collect-evidence.mjs";

const OK_SELFCHECK = [
  { check: "pg", name: "postgres", ok: true, kind: "ready", detail: "pg16" },
  { check: "ready", name: "backend", ok: true, kind: "ready", detail: "ok" },
  { check: "ready", name: "frontend", ok: true, kind: "ready", detail: "ok" }
];

function ctx(overrides = {}) {
  return {
    repository: "liuyejinghong/ai-mud",
    runId: "0",
    runAttempt: "1",
    runNumber: 1,
    eventName: "pull_request",
    runUrl: "https://example.invalid/run/0",
    artifactName: "playtest-evidence-0-attempt1",
    prContext: {
      pr_number: 99,
      pr_head_sha: "head-sha",
      pr_head_branch: "review/some-branch",
      base_branch: "infra/browser-review-env",
      base_branch_sha: "base-sha",
      merge_commit_sha: "merge-sha"
    },
    toolVersions: { node: "v26", pnpm: "9.0.0", git_checkout: "checkout-sha" },
    playwrightVersion: "Version 1.61.1",
    productBaselineSha: "",
    baseUrl: "http://127.0.0.1:4173",
    checkoutSha: "checkout-sha",
    checkoutBranch: "refs/pull/99/merge",
    evidenceFiles: [],
    ...overrides
  };
}

function meta(overrides = {}) {
  return {
    scenario: "s",
    file: "s.spec.ts",
    status: "passed",
    steps_total: 1,
    last_completed_step: "a",
    started_at: "t0",
    finished_at: "t1",
    business_checks: [],
    runtime: { project: "chromium", browser_name: "chromium", browser_version: "141", viewport_final: { width: 1440, height: 900 } },
    notes: {},
    ...overrides
  };
}

describe("buildRunSummary（合成输入）", () => {
  it("resume/pause 均生效 → SMOKE_PASSED，无业务阻塞候选", () => {
    const { manifest } = buildRunSummary({
      selfcheck: OK_SELFCHECK,
      runMetas: [
        meta({ business_checks: [
          { check: "clock_toggle_1", result: "effective", detail: "resume", ts: "t" },
          { check: "clock_toggle_2", result: "effective", detail: "pause", ts: "t" }
        ] })
      ],
      steps: [{ step_id: "a", result: "ok" }],
      context: ctx()
    });
    assert.equal(manifest.status, "SMOKE_PASSED");
    assert.equal(manifest.game_blocked_candidates.length, 0);
  });

  it("resume 无变化 → GAME_BLOCKED，候选含结构化记录", () => {
    const { manifest } = buildRunSummary({
      selfcheck: OK_SELFCHECK,
      runMetas: [
        meta({ business_checks: [
          { check: "clock_toggle_1", result: "no_change", detail: "resume 切换未生效", ts: "t" }
        ] })
      ],
      steps: [{ step_id: "a", result: "ok" }],
      context: ctx()
    });
    assert.equal(manifest.status, "GAME_BLOCKED");
    assert.equal(manifest.game_blocked_candidates[0].ineffective_checks[0].check, "clock_toggle_1");
    assert.equal(manifest.game_blocked_candidates[0].ineffective_checks[0].result, "no_change");
  });

  it("pause 无变化 → GAME_BLOCKED", () => {
    const { manifest } = buildRunSummary({
      selfcheck: OK_SELFCHECK,
      runMetas: [
        meta({ business_checks: [{ check: "clock_toggle_2", result: "no_change", detail: null, ts: "t" }] })
      ],
      steps: [],
      context: ctx()
    });
    assert.equal(manifest.status, "GAME_BLOCKED");
  });

  it("业务检查未执行（not_executed）→ GAME_BLOCKED，不得默认成功", () => {
    const { manifest } = buildRunSummary({
      selfcheck: OK_SELFCHECK,
      runMetas: [
        meta({ business_checks: [{ check: "heartbeat_renewal", result: "not_executed", detail: null, ts: "t" }] })
      ],
      steps: [],
      context: ctx()
    });
    assert.equal(manifest.status, "GAME_BLOCKED");
  });

  it("场景异常（status!=passed）→ SMOKE_FAILED，优先于业务判定", () => {
    const { manifest } = buildRunSummary({
      selfcheck: OK_SELFCHECK,
      runMetas: [meta({ status: "failed" })],
      steps: [],
      context: ctx()
    });
    assert.equal(manifest.status, "SMOKE_FAILED");
  });

  it("没有场景运行且后端未就绪 → BLOCKED_BEFORE_TESTS（不误分类为业务问题）", () => {
    const { manifest } = buildRunSummary({
      selfcheck: [{ check: "ready", name: "backend", ok: false, kind: "service_not_started", detail: "ECONNREFUSED" }],
      runMetas: [],
      steps: [],
      context: ctx()
    });
    assert.equal(manifest.status, "BLOCKED_BEFORE_TESTS");
    assert.equal(manifest.selfcheck.blockers[0].kind, "service_not_started");
  });

  it("必要自检信息缺失（如缺 frontend 记录）→ 场景通过也不判成功（SMOKE_INCONCLUSIVE）", () => {
    const { manifest } = buildRunSummary({
      selfcheck: OK_SELFCHECK.filter((e) => e.name !== "frontend"),
      runMetas: [meta()],
      steps: [],
      context: ctx()
    });
    assert.equal(manifest.status, "SMOKE_INCONCLUSIVE");
    assert.equal(manifest.selfcheck.blockers[0].kind, "missing_selfcheck");
  });

  it("版本来源：PR base 是堆叠目标而非产品基线；未提供基线时写 UNKNOWN 并说明", () => {
    const { manifest } = buildRunSummary({
      selfcheck: OK_SELFCHECK,
      runMetas: [meta()],
      steps: [],
      context: ctx()
    });
    assert.equal(manifest.versions.product_baseline.sha, "UNKNOWN");
    assert.match(manifest.versions.product_baseline.source, /infra\/browser-review-env/);
    assert.equal(manifest.versions.pull_request.base_branch, "infra/browser-review-env");
    assert.equal(manifest.versions.pull_request.head_branch, "review/some-branch");
    assert.equal(manifest.versions.actual_checkout.sha, "checkout-sha");
    assert.equal(manifest.versions.merge_commit_sha, "merge-sha");
  });

  it("提供 PRODUCT_BASELINE_SHA 时按来源记录，且与 checkout 区分", () => {
    const { manifest } = buildRunSummary({
      selfcheck: OK_SELFCHECK,
      runMetas: [meta()],
      steps: [],
      context: ctx({ productBaselineSha: "fad7d4232937d6c3fb216d743edb227589846803" })
    });
    assert.equal(manifest.versions.product_baseline.sha, "fad7d4232937d6c3fb216d743edb227589846803");
    assert.match(manifest.versions.product_baseline.source, /PRODUCT_BASELINE_SHA/);
    assert.notEqual(manifest.versions.product_baseline.sha, manifest.versions.actual_checkout.sha);
  });

  it("每场景携带实际 runtime（视口/浏览器），配置默认值单独存放", () => {
    const { manifest } = buildRunSummary({
      selfcheck: OK_SELFCHECK,
      runMetas: [
        meta({ runtime: { project: "chromium", browser_name: "chromium", browser_version: "141.0.7390.54", viewport_final: { width: 390, height: 844 } } }),
        meta({ scenario: "desktop" })
      ],
      steps: [],
      context: ctx()
    });
    assert.equal(manifest.scenarios[0].runtime.viewport_final.width, 390);
    assert.equal(manifest.scenarios[0].runtime.browser_version, "141.0.7390.54");
    assert.equal(manifest.scenarios[1].runtime.browser_name, "chromium");
    assert.equal(manifest.environment.configured_default.viewport, "1440x900");
  });
});

describe("isIndexableEvidenceFile（清单=上传安全子集）", () => {
  it("隐藏文件不入索引（如 test-results/.last-run.json），清单自身不入索引", () => {
    assert.equal(isIndexableEvidenceFile("test-results/.last-run.json"), false);
    assert.equal(isIndexableEvidenceFile(".env"), false);
    assert.equal(isIndexableEvidenceFile("manifest.json"), false);
    assert.equal(isIndexableEvidenceFile("summary.md"), false);
    assert.equal(isIndexableEvidenceFile("screenshots/s/a-after.png"), true);
    assert.equal(isIndexableEvidenceFile("playwright-report/data/trace.zip"), true);
    assert.equal(isIndexableEvidenceFile("server.log"), true);
  });
});
