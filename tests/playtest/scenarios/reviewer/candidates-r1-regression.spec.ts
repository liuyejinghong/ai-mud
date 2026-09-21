// 候选问题批量修复回归（PR #26：TECH-01/SYNC-01/ECON-01/ECON-02/BUILD-01/UX-01/UX-02/UX-03）。
// CI 跑在 127.0.0.1（安全上下文），TECH-01 的 randomUUID 回退路径无法在 CI 触发，
// 已由交付方在局域网非安全上下文实测（PR #26 描述）；SYNC-01/UX-03 由组件回归覆盖。
// 本场景覆盖线上可复现的四项：BUILD-01 材料清单、ECON-01 到货时间、ECON-02 批量采购、UX-01/UX-02 引导。
import { expect, makePlaytestAccount, test } from "../../fixtures/evidence";

test("candidates-r1 材料清单/到货时间/批量采购/引导行为回归", async ({ page, evidence }) => {
  test.setTimeout(240_000);
  const accountA = makePlaytestAccount();
  evidence.note("account_a_email", accountA.email);

  await evidence.step("register-and-dismiss-intro", "注册账号 A，用 Esc 关闭引导（UX-01）", async () => {
    await page.goto("/");
    await page.getByLabel("邮箱").fill(accountA.email);
    await page.getByLabel("密码", { exact: true }).fill(accountA.password);
    await page.getByRole("button", { name: "领取试玩基地" }).click();
    const intro = page.getByRole("dialog", { name: "新手引导" });
    await expect(intro).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(intro).toBeHidden({ timeout: 5_000 });
    evidence.businessCheck("ux01_escape_closes_intro", "effective", "Esc 关闭引导弹窗");
  }, "页面注册 → Escape 关闭引导");

  await evidence.step("build-materials", "选中建设位 A 显示开工材料清单（BUILD-01）", async () => {
    await page.getByRole("button", { name: /建设位 A/ }).click();
    await expect(page.getByText(/太阳电池阵组件 ×6（现有 6）/)).toBeVisible({ timeout: 10_000 });
    evidence.businessCheck("build01_material_list", "effective", "面板显示材料需求与现有量");
  }, "点击建设位 A，读取对象详情");

  await evidence.step("start-project", "开工首项工程（快照出现在建项目）", async () => {
    await page.getByRole("button", { name: "在这里建设" }).click();
    await expect(page.getByRole("button", { name: "查看这个项目" })).toBeVisible({ timeout: 15_000 });
    evidence.businessCheck("project_started", "effective", "开工后出现「查看这个项目」");
  }, "点击「在这里建设」");

  await evidence.step("bulk-purchase", "按数量批量采购并看到预计到货时间（ECON-01/ECON-02）", async () => {
    await page.getByLabel("购买数量·支架结构件").fill("3");
    const row = page.getByLabel("购买数量·支架结构件").locator("xpath=ancestor::li");
    await row.getByRole("button", { name: "购入" }).click();
    await expect(page.getByText(/支架结构件 ×3（120 credits）· 运输途中 · 预计到货/)).toBeVisible({ timeout: 15_000 });
    evidence.businessCheck("econ_bulk_purchase_eta", "effective", "一次下单 3 件且显示预计到货");
  }, "数量输入 3 → 购入 → 断言在途行含预计到货");

  const accountB = makePlaytestAccount();
  evidence.note("account_b_email", accountB.email);
  await evidence.step("switch-account-intro", "退出换账号 B：引导仍会出现（UX-02 按基地隔离）", async () => {
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page.getByRole("heading", { name: "进入你的基地" })).toBeVisible({ timeout: 12_000 });
    await page.getByLabel("邮箱").fill(accountB.email);
    await page.getByLabel("密码", { exact: true }).fill(accountB.password);
    await page.getByRole("button", { name: "领取试玩基地" }).click();
    await expect(page.getByRole("dialog", { name: "新手引导" })).toBeVisible({ timeout: 30_000 });
    evidence.businessCheck("ux02_per_base_intro", "effective", "新账号仍见到引导");
  }, "退出登录 → 注册 B → 断言引导出现");
});
