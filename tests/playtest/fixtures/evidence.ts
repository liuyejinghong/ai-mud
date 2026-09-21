// 证据采集 fixture：每个场景自动获得 evidence 采集器。
// 产出（均在 PLAYTEST_EVIDENCE_DIR 下）：
//   steps.jsonl     每个操作步骤一条记录（稳定 step_id、意图、前后页面状态、截图、结果）
//   console.jsonl   浏览器 console 消息 + pageerror（脱敏）
//   network.jsonl   请求/响应（方法、URL、状态码；≥400 仅标记不判失败）+ 失败请求
//   run-meta-*.json 每个场景一条：步骤数、最后完成步骤、业务检查结果、测试账号
// 脱敏：password/secret/token/authorization/cookie/csrf 一律掩码；trace 由 Playwright 生成，
// 含一次性隔离账号的表单内容，作业结束随数据库一起销毁（见交接文档）。
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

export const EVIDENCE_DIR = resolve(process.env.PLAYTEST_EVIDENCE_DIR ?? "evidence");

const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|auth|cookie|csrf)/i;

function maskDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => maskDeep(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const masked: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      masked[key] = SENSITIVE_KEY.test(key) ? "***" : maskDeep(item, depth + 1);
    }
    return masked;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

function maskText(text: string): string {
  return text.replace(
    /(password|secret|token|authorization|cookie|csrf)(["']?\s*[:=]\s*)["']?[^"'\s,;}&]+/gi,
    "$1$2***"
  );
}

export interface EvidenceNote {
  [key: string]: unknown;
}

// 业务检查结果合同（生产者 fixture 与消费者 collect-evidence.mjs 共用）：
// effective=动作在页面上真实生效；no_change=点击/提交后页面与网络无变化；
// error=操作抛错；not_executed=场景声明了但未执行。collector 把非 effective 视为业务阻塞。
export type BusinessCheckResult = "effective" | "no_change" | "error" | "not_executed";

export interface BusinessCheckRecord {
  check: string;
  result: BusinessCheckResult;
  detail: string | null;
  ts: string;
}

interface ObservedResponse {
  ts: string;
  method: string;
  url: string;
  status: number;
}

class EvidenceCollector {
  readonly scenarioSlug: string;
  private readonly page: Page;
  private readonly testInfo: TestInfo;
  private readonly screenshotsDir: string;
  private readonly startedAt = new Date().toISOString();
  private stepsTotal = 0;
  private lastCompletedStep: string | null = null;
  private readonly notes: EvidenceNote = {};
  private readonly businessChecks: BusinessCheckRecord[] = [];
  private readonly networkLog: ObservedResponse[] = [];
  private readonly initialViewport: { width: number; height: number } | null;

  constructor(page: Page, testInfo: TestInfo) {
    this.page = page;
    this.testInfo = testInfo;
    this.scenarioSlug = testInfo.titlePath.join("-").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 80);
    this.screenshotsDir = join(EVIDENCE_DIR, "screenshots", this.scenarioSlug);
    this.initialViewport = page.viewportSize();
    mkdirSync(this.screenshotsDir, { recursive: true });
  }

  attach(): void {
    const consolePath = join(EVIDENCE_DIR, "console.jsonl");
    const networkPath = join(EVIDENCE_DIR, "network.jsonl");
    this.page.on("console", (message) => {
      this.appendLine(consolePath, {
        ts: new Date().toISOString(),
        scenario: this.scenarioSlug,
        type: message.type(),
        text: maskText(message.text()).slice(0, 2000),
        location: message.location()?.url ?? null
      });
    });
    this.page.on("pageerror", (error) => {
      this.appendLine(consolePath, {
        ts: new Date().toISOString(),
        scenario: this.scenarioSlug,
        type: "pageerror",
        text: maskText(String(error)).slice(0, 2000)
      });
    });
    this.page.on("response", async (response) => {
      const request = response.request();
      const observed: ObservedResponse = {
        ts: new Date().toISOString(),
        method: request.method(),
        url: response.url(),
        status: response.status()
      };
      this.networkLog.push(observed);
      let postData: unknown = null;
      if (request.method() !== "GET") {
        const raw = request.postData();
        if (raw !== null) {
          try {
            postData = maskDeep(JSON.parse(raw));
          } catch {
            postData = maskText(raw).slice(0, 500);
          }
        }
      }
      this.appendLine(networkPath, {
        ts: new Date().toISOString(),
        scenario: this.scenarioSlug,
        direction: "response",
        method: request.method(),
        url: response.url(),
        status: response.status(),
        status_ge_400: response.status() >= 400,
        resource_type: request.resourceType(),
        post_data: postData
      });
    });
    this.page.on("requestfailed", (request) => {
      this.appendLine(networkPath, {
        ts: new Date().toISOString(),
        scenario: this.scenarioSlug,
        direction: "request_failed",
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText ?? "unknown"
      });
    });
  }

  // 记录补充事实（信息性，写入 run-meta.notes，供 manifest/summary 汇总）。
  note(key: string, value: unknown): void {
    this.notes[key] = value;
  }

  // 业务检查：动作是否真实生效。非 effective 的记录会让 collector 把本次运行判为 GAME_BLOCKED，
  // 摘要必须显式展示，不允许被一句 PASSED 掩盖。
  businessCheck(check: string, result: BusinessCheckResult, detail?: string): void {
    this.businessChecks.push({ check, result, detail: detail ?? null, ts: new Date().toISOString() });
  }

  // 观察真实网络流量（如心跳续租）：轮询本场景已捕获的响应，命中返回 true。
  async observeNetwork(
    match: { urlIncludes: string; method?: string },
    timeoutMs = 45_000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.networkLog.find(
        (entry) =>
          entry.url.includes(match.urlIncludes) &&
          (match.method === undefined || entry.method === match.method) &&
          entry.status < 400
      );
      if (hit !== undefined) return true;
      if (Date.now() > deadline) return false;
      await this.page.waitForTimeout(500);
    }
  }

  // 一个带证据的操作步骤：前后各留页面状态与截图；断言失败也先落证据再抛出。
  async step(stepId: string, intent: string, body: () => Promise<void>, action = ""): Promise<void> {
    this.stepsTotal += 1;
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const before = await this.capture(`${stepId}-before`);
    let failure: unknown = null;
    try {
      await body();
    } catch (error) {
      failure = error;
      await this.screenshot(`${stepId}-error`).catch(() => undefined);
    }
    const after = await this.capture(`${stepId}-after`);
    this.appendLine(join(EVIDENCE_DIR, "steps.jsonl"), {
      step_id: stepId,
      ts: startedAt,
      scenario: this.scenarioSlug,
      intent,
      action,
      before,
      after,
      result: failure === null ? "ok" : "error",
      error: failure === null ? null : maskText(failure instanceof Error ? failure.message : String(failure)).slice(0, 1000),
      duration_ms: Date.now() - startedMs
    });
    if (failure === null) {
      this.lastCompletedStep = stepId;
    } else {
      throw failure;
    }
  }

  private async capture(tag: string) {
    const screenshotFile = await this.screenshot(tag);
    const visibleText = await this.page
      .locator("body")
      .innerText({ timeout: 3000 })
      .then((text) => maskText(text).replace(/\s+/g, " ").slice(0, 1500))
      .catch(() => "(page text unavailable)");
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ""),
      visible_text: visibleText,
      screenshot: screenshotFile
    };
  }

  private async screenshot(tag: string): Promise<string | null> {
    try {
      const file = join("screenshots", this.scenarioSlug, `${tag}.png`);
      await this.page.screenshot({ path: join(EVIDENCE_DIR, file), fullPage: true });
      return file;
    } catch {
      return null;
    }
  }

  private appendLine(path: string, entry: unknown): void {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
  }

  async finish(): Promise<void> {
    const browser = this.page.context().browser();
    const projectUse = this.testInfo.project.use as { timezoneId?: string };
    const finalViewport = this.page.viewportSize();
    const meta = {
      scenario: this.testInfo.title,
      file: basename(this.testInfo.file),
      status: this.testInfo.status,
      expected_status: this.testInfo.expectedStatus,
      started_at: this.startedAt,
      finished_at: new Date().toISOString(),
      steps_total: this.stepsTotal,
      last_completed_step: this.lastCompletedStep,
      // 结构化业务结果：collector 依赖本合同（BusinessCheckRecord[]）判定业务是否生效。
      business_checks: this.businessChecks,
      notes: this.notes,
      runtime: {
        project: this.testInfo.project.name,
        browser_name: browser?.browserType().name() ?? null,
        browser_version: browser?.version() ?? null,
        viewport_initial: this.initialViewport,
        viewport_final: finalViewport,
        viewport_changed: JSON.stringify(this.initialViewport) !== JSON.stringify(finalViewport),
        timezone_id: projectUse.timezoneId ?? null
      },
      playwright_test_id: this.testInfo.testId
    };
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, `run-meta-${this.scenarioSlug}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  }
}

export const test = base.extend<{ evidence: EvidenceCollector }>({
  evidence: [
    async ({ page }, use, testInfo) => {
      const collector = new EvidenceCollector(page, testInfo);
      collector.attach();
      await use(collector);
      await collector.finish();
    },
    { auto: true }
  ]
});

export { expect };

// 一次性试玩账号：邮箱含 run 标签便于对账；密码仅存在于本次隔离环境，作业结束即失效。
export function makePlaytestAccount(): { email: string; password: string } {
  const runTag = process.env.GITHUB_RUN_ID ?? `local-${new Date().toISOString().slice(0, 10)}`;
  return {
    email: `playtest-${runTag}-${randomUUID().slice(0, 8)}@example.invalid`,
    password: `pt-${randomUUID()}`
  };
}
