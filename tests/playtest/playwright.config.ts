import { defineConfig } from "@playwright/test";

// 浏览器验收场景配置。证据目录由 PLAYTEST_EVIDENCE_DIR 控制（CI 与本地一致写入 tests/playtest/evidence）。
const evidenceDir = process.env.PLAYTEST_EVIDENCE_DIR ?? "evidence";

export default defineConfig({
  testDir: "./scenarios",
  // 一次跑一个场景文件，证据按顺序落盘，避免交叉写入。
  workers: 1,
  fullyParallel: false,
  // 重试会掩盖第一次失败；证据要求第一次失败也完整保留，故关闭自动重试。
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: `${evidenceDir}/test-results`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${evidenceDir}/playwright-report.json` }],
    ["html", { outputFolder: `${evidenceDir}/playwright-report`, open: "never" }]
  ],
  use: {
    baseURL: process.env.PLAYTEST_BASE_URL ?? "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 900 },
    timezoneId: "Asia/Shanghai",
    // trace 与 screenshot 常开：成功运行也保留完整 trace 和关键截图（不只是失败时）。
    // 注意：trace 含表单提交内容；本环境账号/密码均为一次性隔离凭据，作业结束即销毁。
    trace: { mode: "on", screenshots: true, snapshots: true, sources: false },
    screenshot: "on",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 20_000
  }
});
