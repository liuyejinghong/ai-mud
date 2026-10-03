import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP("http://localhost:9806");
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
page.on("dialog", (d) => { console.log("DIALOG:", d.message()); d.accept().catch(() => {}); });

await page.goto("http://107.175.209.173:8088", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(4000); // session restore + base load

// h1 & base name
console.log("h1:", await page.evaluate(() => document.querySelector("h1")?.innerText ?? null));
console.log("base-name el:", await page.evaluate(() => document.querySelector(".landing-base-name")?.innerText ?? null));

// click 操作 tab
const opTab = page.locator("text=操作").first();
if (await opTab.count() > 0) {
  await opTab.click({ timeout: 8000 }).catch((e) => console.log("opTab click fail:", e.message));
  await page.waitForTimeout(1500);
}
const body = await page.evaluate(() => document.body.innerText);
console.log("=== OPERATION TAB BODY (2200 chars) ===");
console.log(body.slice(0, 2200));
await page.screenshot({ path: "/tmp/yudian-counter0/06-operation.png", fullPage: true });

// search whole DOM for social/identity keywords
const kw = await page.evaluate(() => {
  const t = document.body.innerText;
  const words = ["聊天", "玩家", "排行榜", "在场", "频道", "称谓", "角色", "指挥官", "先遣"];
  const hits = {};
  for (const w of words) hits[w] = t.includes(w);
  return hits;
});
console.log("=== KEYWORD HITS ===", JSON.stringify(kw));
await page.close();
await browser.close();
console.log("DONE");
