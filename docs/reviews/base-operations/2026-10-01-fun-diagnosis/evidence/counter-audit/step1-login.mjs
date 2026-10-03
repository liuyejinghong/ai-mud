import { chromium } from "playwright-core";

const rand = Math.random().toString(36).slice(2, 8);
const email = `review-diag-counter-0-${rand}@example.invalid`;
const password = `Cx0-${rand}-diag!`;

const browser = await chromium.connectOverCDP("http://localhost:9806");
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();

const url = "http://107.175.209.173:8088";
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
} catch (e) {
  console.log("PRIMARY_FAIL", e.message);
  await page.goto("http://100.113.202.78:8088", { waitUntil: "domcontentloaded", timeout: 20000 });
}
await page.waitForTimeout(2000);

// 1) login page text
const bodyText = await page.evaluate(() => document.body.innerText);
console.log("=== LOGIN PAGE TEXT ===");
console.log(bodyText.slice(0, 1500));
await page.screenshot({ path: "/tmp/yudian-counter0/01-login.png", fullPage: true });

// 2) register
console.log("=== REGISTER FORM ===");
const inputs = await page.locator("input").all();
console.log("input count:", inputs.length);
for (const inp of inputs) {
  console.log("input:", await inp.getAttribute("id"), await inp.getAttribute("type"), await inp.getAttribute("name"));
}
const emailInput = page.locator("input[type=email], #base-auth-email").first();
await emailInput.fill(email);
await page.locator("input[type=password]").first().fill(password);
await page.screenshot({ path: "/tmp/yudian-counter0/02-filled.png" });
// list buttons
const btns = await page.locator("button").all();
for (const b of btns) console.log("button:", JSON.stringify(await b.innerText()));
console.log("EMAIL=" + email);
console.log("PASSWORD=" + password);
await ctx.close?.();
await page.close();
await browser.close();
