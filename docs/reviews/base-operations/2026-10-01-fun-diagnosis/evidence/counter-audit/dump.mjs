import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP("http://localhost:9806");
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.goto("http://107.175.209.173:8088", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);

const html = await page.evaluate(() => {
  const form = document.querySelector("form");
  return form ? form.outerHTML.slice(0, 3000) : document.body.innerHTML.slice(0, 3000);
});
console.log(html);
await page.close();
await browser.close();
