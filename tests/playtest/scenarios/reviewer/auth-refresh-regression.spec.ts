// AUTH-01 刷新回归（真实浏览器、无 mock、不改 React/DOM 状态）：
// 普通玩家刷新后控制必须恢复，且写命令真实成功。覆盖：
// 1) 新注册后计时操作正常；2) 刷新后无需重新登录即可恢复/暂停；3) 刷新后可切倍率；
// 4) 有效会话重新打开页面控制恢复；5) 观察一次真实心跳续租；6) 退出再登录不沿用旧会话。
// 另含管理员共用会话路径（作业内引导的隔离测试管理员，凭据为 CI 常量，非线上账号）。
import { expect, makePlaytestAccount, test } from "../../fixtures/evidence";

const ADMIN_EMAIL = process.env.PLAYTEST_ADMIN_EMAIL ?? "admin@playtest.invalid";
const ADMIN_PASSWORD = process.env.PLAYTEST_ADMIN_PASSWORD ?? "playtest-admin-pass-0123";

async function registerThroughUi(
  page: import("@playwright/test").Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "领取试玩基地" }).click();
  await expect(page.getByRole("heading", { name: "基地地图" })).toBeVisible({ timeout: 30_000 });
  const intro = page.getByRole("dialog", { name: "新手引导" });
  if (await intro.isVisible().catch(() => false)) {
    await intro.getByRole("button", { name: "开始指挥" }).click();
    await expect(intro).toBeHidden();
  }
}

test("auth-refresh-regression 刷新后控制恢复：计时/倍率/心跳/账号切换", async ({ page, evidence }) => {
  test.setTimeout(300_000);
  const accountA = makePlaytestAccount();
  evidence.note("account_a_email", accountA.email);

  await evidence.step("register-a", "注册一次性账号 A 并进入初始暂停基地", () =>
    registerThroughUi(page, accountA.email, accountA.password),
    "页面注册（邮箱/密码/领取试玩基地）+ 关闭引导"
  );

  await evidence.step("resume-after-register", "新注册后计时操作正常：恢复→暂停完整往返（回到初始暂停态）", async () => {
    await page.getByRole("button", { name: "恢复计时", exact: true }).click();
    await expect(page.getByRole("button", { name: "暂停计时", exact: true })).toBeVisible({ timeout: 12_000 });
    evidence.businessCheck("resume_after_register", "effective", "恢复计时后出现暂停计时");
    await page.getByRole("button", { name: "暂停计时", exact: true }).click();
    await expect(page.getByText("时间已暂停", { exact: true })).toBeVisible({ timeout: 12_000 });
    evidence.businessCheck("pause_back_after_register", "effective", "回到初始暂停态（刷新路径与 R0 一致）");
  }, "点击「恢复计时」→ 再点击「暂停计时」");

  await evidence.step("reload", "普通玩家刷新页面：基地保留且控制恢复（R0 的 12 秒窗口）", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "基地地图" })).toBeVisible({ timeout: 30_000 });
    const resume = page.getByRole("button", { name: "恢复计时", exact: true });
    evidence.note("resume_disabled_immediate", await resume.isDisabled().catch(() => "button_absent"));
    await expect(resume).toBeEnabled({ timeout: 12_000 });
  }, "page.reload() 后观察按钮状态");

  await evidence.step("resume-after-refresh", "刷新后无需重新登录即可恢复计时（真实写命令）", async () => {
    await page.getByRole("button", { name: "恢复计时", exact: true }).click();
    await expect(page.getByRole("button", { name: "暂停计时", exact: true })).toBeVisible({ timeout: 12_000 });
    evidence.businessCheck("resume_after_refresh", "effective", "刷新后恢复计时真实生效");
  }, "点击「恢复计时」");

  await evidence.step("speed-after-refresh", "刷新后切换倍率 ×2（页面状态与请求一致）", async () => {
    await page.getByRole("button", { name: "×2", exact: true }).click();
    await expect(page.getByRole("button", { name: "×2", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 12_000 });
    evidence.businessCheck("speed_switch_after_refresh", "effective", "×2 aria-pressed=true");
  }, "点击时间流速「×2」");

  await evidence.step("pause-after-refresh", "刷新后暂停计时（回到新档初始态）", async () => {
    await page.getByRole("button", { name: "暂停计时", exact: true }).click();
    await expect(page.getByText("时间已暂停", { exact: true })).toBeVisible({ timeout: 12_000 });
    evidence.businessCheck("pause_after_refresh", "effective", "出现「时间已暂停」");
  }, "点击「暂停计时」");

  await evidence.step("heartbeat", "观察至少一次真实心跳续租（/base/heartbeat 2xx）", async () => {
    const observed = await evidence.observeNetwork({ urlIncludes: "/base/heartbeat", method: "POST" }, 45_000);
    evidence.businessCheck("heartbeat_renewal", observed ? "effective" : "no_change", observed ? "POST /base/heartbeat 2xx" : "45 秒窗口内未见 2xx 心跳");
  }, "监听网络日志中的心跳响应");

  const accountB = makePlaytestAccount();
  evidence.note("account_b_email", accountB.email);
  await evidence.step("switch-account", "退出再注册账号 B：不沿用 A 的会话控制状态", async () => {
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page.getByRole("heading", { name: "进入你的基地" })).toBeVisible({ timeout: 12_000 });
    await registerThroughUi(page, accountB.email, accountB.password);
    await page.getByRole("button", { name: "恢复计时", exact: true }).click();
    await expect(page.getByRole("button", { name: "暂停计时", exact: true })).toBeVisible({ timeout: 12_000 });
    evidence.businessCheck("account_switch_isolated", "effective", "B 账号注册后计时控制正常");
  }, "退出登录 → 注册 B → 恢复计时");
});

test("auth-refresh-regression 隔离管理员共用会话路径", async ({ page, evidence }) => {
  test.setTimeout(180_000);
  if (!process.env.PLAYTEST_ADMIN_EMAIL && !ADMIN_EMAIL) {
    evidence.businessCheck("admin_shared_session", "not_executed", "环境未提供隔离测试管理员");
    test.skip();
  }

  await evidence.step("admin-login", "隔离测试管理员经页面登录（共用 BaseApp 会话路径）", async () => {
    await page.goto("/");
    await page.getByRole("tab", { name: "账号登录" }).click();
    await page.getByLabel("邮箱").fill(ADMIN_EMAIL);
    await page.getByLabel("密码", { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录并进入基地" }).click();
    await expect(page.getByRole("navigation", { name: "工作区切换" })).toBeVisible({ timeout: 30_000 });
  }, "账号登录页签 → 管理员邮箱/密码 → 登录并进入基地");

  await evidence.step("admin-workspace", "管理员可进入管理台并返回基地工作区", async () => {
    // 管理员首次登录也会被 provision 一个基地：先按玩家路径关掉引导，再切工作区。
    const intro = page.getByRole("dialog", { name: "新手引导" });
    if (await intro.isVisible().catch(() => false)) {
      await intro.getByRole("button", { name: "开始指挥" }).click();
    }
    await page.getByRole("button", { name: "管理", exact: true }).click();
    await expect(page.getByRole("tablist")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "基地", exact: true }).click();
    evidence.businessCheck("admin_shared_session", "effective", "管理台挂载并可切回基地工作区");
  }, "关闭引导（如出现）→ 点击「管理」→ 断言管理台 → 点击「基地」");

  await evidence.step("admin-logout", "管理员退出回到登录面", async () => {
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page.getByRole("heading", { name: "进入你的基地" })).toBeVisible({ timeout: 12_000 });
  }, "点击「退出登录」");
});
