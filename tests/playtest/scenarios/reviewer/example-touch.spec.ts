// 评审场景最小模板（已实际跑通）：复制本文件改名即可开始写你自己的操作场景。
// 约定：
// - 只通过页面操作（点击/填写/滚动/键盘/刷新/等待），不直接调 API/写库/改 localStorage 跳过玩法；
// - 每个关键操作用 evidence.step 包住：步骤 id 稳定、意图写清楚，前后截图/页面文本自动落盘；
// - 账号用 makePlaytestAccount() 现场创建（一次性、隔离、每轮新档）；
// - 不预设业务成功时用 evidence.note 记录观察，不要硬断言；
// - 场景标题带上一个稳定标识词（如 example-touch），供 --grep 定向运行。
import { expect, makePlaytestAccount, test } from "../../fixtures/evidence";

test("example-touch 评审场景模板：注册进基地并查看一个设施", async ({ page, evidence }) => {
  test.setTimeout(120_000);
  const account = makePlaytestAccount();
  evidence.note("account_email", account.email);

  await evidence.step(
    "open-home",
    "打开游戏首页，确认页面可达",
    async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "进入你的基地" })).toBeVisible();
    },
    "goto /"
  );

  await evidence.step(
    "register-and-enter-base",
    "注册一次性账号并进入基地（把这里的操作换成你要验收的玩法步骤）",
    async () => {
      await page.getByLabel("邮箱").fill(account.email);
      await page.getByLabel("密码", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "领取试玩基地" }).click();
      await expect(page.getByRole("heading", { name: "基地地图" })).toBeVisible({ timeout: 30_000 });
      const dialog = page.getByRole("dialog", { name: "新手引导" });
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole("button", { name: "开始指挥" }).click();
      }
    },
    "填写邮箱/密码 → 「领取试玩基地」→ 关闭引导"
  );

  await evidence.step(
    "inspect-first-site",
    "点开地图上第一个设施，记录详情页展示内容",
    async () => {
      const siteCard = page.locator(".base-site-card").first();
      const siteName = await siteCard.locator(".base-site-title").innerText();
      evidence.note("inspected_site", siteName);
      await siteCard.click();
      await expect(page.getByRole("heading", { name: siteName })).toBeVisible();
    },
    "点击第一个 .base-site-card"
  );
});
