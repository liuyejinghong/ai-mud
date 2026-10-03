import { chromium } from "playwright-core";
import { appendFileSync } from "node:fs";

const email = "review-diag-counter-0-0ugu4l@example.invalid";
const password = "Cx0-0ugu4l-diag!";

const browser = await chromium.connectOverCDP("http://localhost:9806");
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
page.on("dialog", (d) => { console.log("DIALOG:", d.message()); d.accept().catch(() => {}); });

await page.goto("http://107.175.209.173:8088", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);

const emailInput = page.locator("input[type=email], #base-auth-email").first();
await emailInput.fill(email);
await page.locator("input[type=password]").first().fill(password);

// click 试玩注册 (trusted click)
const regBtn = page.getByRole("button", { name: "试玩注册" }).first();
await regBtn.click();
await page.waitForTimeout(3000);
console.log("=== AFTER REGISTER, BODY ===");
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1200));
await page.screenshot({ path: "/tmp/yudian-counter0/03-after-register.png", fullPage: true });

// try claim base if button exists
const claim = page.getByRole("button", { name: /领取试玩基地/ }).first();
if (await claim.count() > 0 && (await claim.isVisible().catch(() => false))) {
  console.log("claiming base...");
  await claim.click();
  await page.waitForTimeout(4000);
}
console.log("=== AFTER CLAIM, BODY ===");
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 2000));
await page.screenshot({ path: "/tmp/yudian-counter0/04-after-claim.png", fullPage: true });

// save session state for reuse
appendFileSync("/tmp/yudian-counter0/session.txt", `url=${page.url()}\n`);
await page.close();
await browser.close();
console.log("DONE");
