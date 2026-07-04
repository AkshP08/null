// 390px headless smoke test for the Fragility Explorer heatmap.
// Drives the guided example (golden cross → 2D fragility grid), reveals the
// truth, and asserts the heatmap renders with zero console errors.
import puppeteer from "puppeteer-core";

const URL = process.env.SMOKE_URL || "http://localhost:4173/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
const pageErrors = [];
const failedReqs = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("requestfailed", (r) => failedReqs.push(`${r.url()} :: ${r.failure()?.errorText}`));

  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });

  // Landing → click the guided example (btn-ghost) once data is ready.
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => /guided example|autopsy a classic/i.test(x.textContent)
    );
    return b && !b.disabled;
  }, { timeout: 30000 });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((x) => /guided example|autopsy a classic/i.test(x.textContent))
      .click();
  });

  // Wait for results-locked → click "REVEAL THE TRUTH".
  await page.waitForFunction(() => {
    return [...document.querySelectorAll("button")].some((x) => /REVEAL THE TRUTH/i.test(x.textContent));
  }, { timeout: 30000 });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((x) => /REVEAL THE TRUTH/i.test(x.textContent)).click();
  });

  // Wait for the Fragility Explorer heatmap grid to render actual cells.
  await page.waitForFunction(() => {
    const eyebrows = [...document.querySelectorAll("*")].filter((n) =>
      /Fragility explorer/i.test(n.textContent || "") && n.children.length < 3
    );
    return document.body.textContent.includes("Fragility explorer");
  }, { timeout: 30000 });

  // Give the grid a beat to paint, then inspect it.
  await wait(600);

  const grid = await page.evaluate(() => {
    // The heatmap is the grid whose direct children are aspect-ratio-1 cells.
    const grids = [...document.querySelectorAll('div[style*="grid-template-columns"]')];
    let best = null;
    for (const g of grids) {
      const cells = [...g.children].filter((c) => /aspect-ratio/.test(c.getAttribute("style") || ""));
      if (cells.length && (!best || cells.length > best.count)) {
        const colored = cells.filter((c) => {
          const bg = getComputedStyle(c).backgroundColor;
          return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
        }).length;
        const marker = g.querySelector("span"); // ◆ user marker
        const rect = g.getBoundingClientRect();
        best = { count: cells.length, colored, hasMarker: !!marker, width: Math.round(rect.width), overflow: rect.right > 390 };
      }
    }
    const badge = /FRAGILE|ROBUST|MIXED|NO EDGE|INCONCLUSIVE/.exec(document.body.textContent);
    return { grid: best, badge: badge ? badge[0] : null, sharpeReadout: /OOS Sharpe/i.test(document.body.textContent) };
  });

  await page.screenshot({ path: "/Users/akshpatel/Downloads/Null/_smoke.png" });

  console.log(JSON.stringify({
    ok: !!(grid.grid && grid.grid.count > 0 && grid.grid.colored > 0),
    grid: grid.grid,
    badge: grid.badge,
    sharpeReadout: grid.sharpeReadout,
    consoleErrors: errors,
    pageErrors,
    failedRequests: failedReqs,
  }, null, 2));
} finally {
  await browser.close();
}
