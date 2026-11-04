// Loads the site in a real phone-sized browser and prints what a visitor
// would hit: final address, console/page errors, failed requests, visible text.
import { chromium, devices } from "playwright";
const base = process.argv[2] || "https://seasonz.onrender.com";
const browser = await chromium.launch();
for (const [label, dev] of [["iPhone", devices["iPhone 14"]], ["desktop", devices["Desktop Chrome"]]]) {
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(`console: ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => errs.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("requestfailed", (r) => errs.push(`failed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && errs.push(`HTTP ${r.status()}: ${r.url().slice(0, 120)}`));
  for (const path of ["/", "/login"]) {
    errs.length = 0;
    const t = Date.now();
    let status = "?";
    try {
      const res = await page.goto(base + path, { waitUntil: "networkidle", timeout: 120000 });
      status = res?.status();
    } catch (e) {
      errs.push(`goto: ${String(e).slice(0, 200)}`);
    }
    await page.waitForTimeout(3000);
    const text = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor).catch(() => "?");
    const vis = await page.evaluate(() => { const f = document.querySelector("form"); if (!f) return "no form"; const r = f.getBoundingClientRect(); const s = getComputedStyle(f); return `form ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.top)} opacity ${s.opacity} visibility ${s.visibility}`; }).catch(() => "?");
    const sw = await page.evaluate(() => navigator.serviceWorker?.controller ? "service worker active" : "no service worker").catch(() => "?");
    console.log(`[${label}] ${path} -> ${page.url()} status ${status} in ${Date.now() - t}ms | bg ${bg} | ${vis} | ${sw}`);
    console.log(`  text: ${text || "(empty)"}`);
    for (const e of [...new Set(errs)].slice(0, 15)) console.log(`  ! ${e}`);
  }
  await ctx.close();
}
await browser.close();
