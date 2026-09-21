// 环境自检场景（基础设施验收用，不替代玩法验收）：
// 1. 真实打开游戏首页（非错误页/白屏）
// 2. 通过页面注册一次性试玩账号并进入基地
// 3. 关闭新手引导
// 4. 选择设施（建设位 A）并确认显示对应详情
// 5. 一轮可恢复的真实业务操作：暂停/恢复计时（记录请求与页面反馈，不预设成功）
import type { Page } from "@playwright/test";
import { expect, makePlaytestAccount, test } from "../fixtures/evidence";

async function pausedBadgeVisible(page: Page): Promise<boolean> {
  return page
    .getByText("时间已暂停", { exact: true })
    .isVisible()
    .catch(() => false);
}

// 业务操作的软校验：轮询页面反馈，到时返回 false（不抛错、不让运行变红，由证据和评审判断）。
async function pollUntil(page: Page, check: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(500);
  }
}

test("environment-smoke 全新环境自检：页面注册进基地 + 可恢复计时操作", async ({ page, evidence }) => {
  test.setTimeout(180_000);
  const account = makePlaytestAccount();
  evidence.note("account_email", account.email);
  evidence.note("base_url", process.env.PLAYTEST_BASE_URL ?? "http://127.0.0.1:4173");

  await evidence.step(
    "open-home",
    "打开游戏首页，确认是真实游戏页面而非错误页/白屏",
    async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "进入你的基地" })).toBeVisible();
    },
    "goto /"
  );

  await evidence.step(
    "register-playtest-account",
    "通过页面注册一次性试玩账号并领取基地（账号见 run-meta.business_checks.account_email）",
    async () => {
      await page.getByLabel("邮箱").fill(account.email);
      await page.getByLabel("密码", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "领取试玩基地" }).click();
      await expect(page.getByRole("heading", { name: "基地地图" })).toBeVisible({ timeout: 30_000 });
    },
    "填写邮箱/密码 → 点击「领取试玩基地」→ 等待基地界面"
  );

  await evidence.step(
    "dismiss-intro",
    "关闭新手引导弹窗",
    async () => {
      const dialog = page.getByRole("dialog", { name: "新手引导" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "开始指挥" }).click();
      await expect(dialog).toBeHidden();
    },
    "点击「开始指挥」"
  );

  await evidence.step(
    "select-construction-site",
    "选择设施「建设位 A」，确认显示对应详情",
    async () => {
      const siteCard = page.getByRole("button", { name: /建设位 A/ });
      await siteCard.click();
      await expect(siteCard).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("heading", { name: "建设位 A" })).toBeVisible();
      await expect(page.getByText("这是一块空地，可以开工一个项目。")).toBeVisible();
      await expect(page.getByRole("button", { name: "在这里建设" }).first()).toBeVisible();
    },
    "点击基地地图上的「建设位 A」卡片"
  );

  // 以下两步是真实业务操作：暂停↔恢复一个完整往返（结束回到初始状态）。
  // 结果只记录、不预设成功；失败会体现在 run-meta 的 business_checks，
  // 运行本身不因此变红（是否构成游戏缺陷由评审判断）。
  const toggleClock = async (label: string, noteKey: string) => {
    const wasPaused = await pausedBadgeVisible(page);
    await page
      .getByRole("button", { name: wasPaused ? "恢复计时" : "暂停计时" })
      .click();
    const changed = await pollUntil(page, async () => (await pausedBadgeVisible(page)) !== wasPaused);
    evidence.note(noteKey, `${wasPaused ? "resume" : "pause"}_${changed ? "ok" : "no_change_after_click"}`);
  };

  await evidence.step(
    "clock-toggle-on",
    "业务操作：切换基地计时一次（暂停↔恢复，记录页面反馈，不预设成功）",
    () => toggleClock("切换计时", "toggle_1_result"),
    "点击时间区的「暂停计时」或「恢复计时」"
  );

  await evidence.step(
    "clock-toggle-back",
    "业务操作：切回操作前的计时状态",
    () => toggleClock("切回计时", "toggle_2_result"),
    "再次点击时间区计时按钮"
  );

  await evidence.step(
    "final-state",
    "记录最终基地状态（截图/页面文本/网络日志已随步骤落盘）",
    async () => {
      await expect(page.locator("main.base-shell")).toBeVisible();
    },
    "整页快照"
  );
});
