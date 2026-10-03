import { chromium } from "playwright-core";

const email = "review-diag-counter-0-0ugu4l@example.invalid";
const password = "Cx0-0ugu4l-diag!";

const browser = await chromium.connectOverCDP("http://localhost:9806");
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
page.on("dialog", (d) => { console.log("DIALOG:", d.message()); d.accept().catch(() => {}); });

await page.goto("http://107.175.209.173:8088", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);

await page.locator("#base-auth-email").fill(email);
await page.locator("#base-auth-password").fill(password);
await page.waitForTimeout(500);

const submit = page.locator("button.base-primary-button").first();
console.log("submit disabled?", await submit.isDisabled().catch(() => "?"));
await submit.click({ timeout: 10000 });
await page.waitForTimeout(5000);

console.log("=== AFTER SUBMIT URL ===", page.url());
const text = await page.evaluate(() => document.body.innerText);
console.log("=== BODY (2400 chars) ===");
console.log(text.slice(0, 2400));
await page.screenshot({ path: "/tmp/yudian-counter0/05-after-submit.png", fullPage: true });
await page.close();
await browser.close();
console.log("DONE");
