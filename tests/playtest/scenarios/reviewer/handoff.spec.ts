// Independent reviewer round R0. Real UI only; no API writes, mocks, clock overrides,
// storage injection or product changes. A failed assertion is evidence, not permission to fix the game.
import { expect, makePlaytestAccount, test } from "../../fixtures/evidence";

// This round is intentionally short: it verifies reviewer -> PR -> Actions -> evidence,
// and three bounded player paths. It does not certify the complete game loop.
test.beforeEach(async ({ page, evidence, browser }) => {
  evidence.note("review_scope", "R0 independent handoff; not full game acceptance");
  evidence.note("game_implementation_sha", "fad7d4232937d6c3fb216d743edb227589846803");
  evidence.note("infra_baseline_sha", "b14ee1603fa06a4d4f2259db7c96fb98e8188ab7");
  evidence.note("actual_browser_version", browser.version());
  evidence.note("actual_viewport", page.viewportSize());
  const account = makePlaytestAccount();
  evidence.note("account_email", account.email);

  await evidence.step("open", "打开真实游戏登录入口", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "进入你的基地" })).toBeVisible();
    evidence.note("secure_context", await page.evaluate(() => window.isSecureContext));
    evidence.note("browser_timezone", await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, "goto /");

  await evidence.step("register", "页面注册独立测试新档", async () => {
    await page.getByLabel("邮箱").fill(account.email);
    await page.getByLabel("密码", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "领取试玩基地" }).click();
    await expect(page.getByRole("heading", { name: "基地地图" })).toBeVisible({ timeout: 30000 });
  }, "填写一次性邮箱和密码，再点击领取试玩基地");

  await evidence.step("intro", "核验新档引导并通过按钮关闭", async () => {
    const intro = page.getByRole("dialog", { name: "新手引导" });
    await expect(intro).toBeVisible();
    await intro.getByRole("button", { name: "开始指挥" }).click();
    await expect(intro).toBeHidden();
  }, "点击开始指挥");
});

test("R0 refresh retains usable controls", async ({ page, evidence }) => {
  await evidence.step("before-reload", "确认注册后计时操作可用", async () => {
    await expect(page.getByRole("button", { name: "恢复计时", exact: true })).toBeEnabled();
    evidence.note("inventory_before_reload", await page.locator(".base-resource-chip").allTextContents());
  }, "读取界面按钮和库存");

  await evidence.step("reload", "普通玩家刷新页面后保持基地与操作能力", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "基地地图" })).toBeVisible({ timeout: 30000 });
    evidence.note("inventory_after_reload", await page.locator(".base-resource-chip").allTextContents());
    evidence.note("resume_disabled_immediate", await page.getByRole("button", { name: "恢复计时", exact: true }).isDisabled());
    await expect(page.getByRole("button", { name: "恢复计时", exact: true })).toBeEnabled({ timeout: 12000 });
  }, "浏览器刷新，等待基地显示，核验恢复计时可用");

  await evidence.step("resume", "刷新后通过页面恢复计时", async () => {
    await page.getByRole("button", { name: "恢复计时", exact: true }).click();
    await expect(page.getByRole("button", { name: "暂停计时", exact: true })).toBeVisible();
  }, "点击恢复计时");

  await evidence.step("pause", "恢复为初始暂停状态", async () => {
    await page.getByRole("button", { name: "暂停计时", exact: true }).click();
    await expect(page.getByText("时间已暂停", { exact: true })).toBeVisible();
  }, "点击暂停计时");
});

test("R0 paused construction cancellation", async ({ page, evidence }) => {
  let inventoryBefore: string[] = [];
  await evidence.step("select-site", "暂停新档中选择建设位并记录物资", async () => {
    await expect(page.getByText("时间已暂停", { exact: true })).toBeVisible();
    inventoryBefore = (await page.locator(".base-resource-chip").allTextContents()).sort();
    evidence.note("inventory_before_build", inventoryBefore);
    await page.getByRole("button", { name: /建设位 A/ }).click();
    await expect(page.getByRole("button", { name: "在这里建设", exact: true })).toBeVisible();
  }, "选择建设位 A；读取物资");

  await evidence.step("build", "通过页面创建真实工程，未快进时钟", async () => {
    await page.getByRole("button", { name: "在这里建设", exact: true }).click();
    await expect(page.getByRole("button", { name: "查看这个项目", exact: true })).toBeVisible();
    evidence.note("inventory_after_build", await page.locator(".base-resource-chip").allTextContents());
  }, "点击在这里建设");

  await evidence.step("inspect-project", "查看在建项目与取消入口", async () => {
    await page.getByRole("button", { name: "查看这个项目", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消项目", exact: true })).toBeVisible();
    evidence.note("project_detail_before_cancel", await page.getByRole("complementary", { name: "对象详情" }).innerText());
  }, "点击查看这个项目");

  await evidence.step("cancel", "读取损失提示并确认取消未施工项目", async () => {
    page.once("dialog", async (dialog) => {
      evidence.note("cancel_confirmation", dialog.message());
      await dialog.accept();
    });
    await page.getByRole("button", { name: "取消项目", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消项目", exact: true })).toBeHidden();
  }, "点击取消项目并接受浏览器确认框");

  await evidence.step("verify-release", "工程位释放且未消耗的物资恢复", async () => {
    await page.getByRole("button", { name: /建设位 A/ }).click();
    await expect(page.getByRole("button", { name: "在这里建设", exact: true })).toBeVisible();
    await expect.poll(async () => (await page.locator(".base-resource-chip").allTextContents()).sort()).toEqual(inventoryBefore);
    evidence.note("inventory_after_cancel", await page.locator(".base-resource-chip").allTextContents());
  }, "回到建设位 A，比较取消前后的真实库存");
});

test.describe("narrow viewport evidence", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("R0 narrow viewport remains operable", async ({ page, evidence }) => {
    await evidence.step("select-narrow", "窄屏打开设施并记录实际视口与页面宽度", async () => {
      await page.getByRole("button", { name: /建设位 A/ }).click();
      await expect(page.getByRole("heading", { name: "建设位 A", exact: true })).toBeVisible();
      evidence.note("layout_actual", await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      })));
      await expect(page.getByRole("button", { name: "在这里建设", exact: true })).toBeVisible();
    }, "窄屏下滚动并点击建设位 A，读取布局事实（不冒充触控设备测试）");
  });
});
