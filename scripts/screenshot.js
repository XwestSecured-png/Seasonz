const { chromium } = require("playwright");

const BASE = "http://localhost:3100";
const PASSWORD = "changeme-before-deploy";

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  iphone: { width: 390, height: 844 }, // iPhone 14/15-ish
};

const PAGES = [
  { path: "/", name: "dashboard" },
  { path: "/injury-impact", name: "injury-impact" },
  { path: "/model-tracker", name: "model-tracker" },
  { path: "/elo-ratings", name: "elo-ratings" },
];

// Favorite-team cookie scenarios to capture, in addition to the no-team default.
const TEAM_SCENARIOS = [
  { code: "PIT", label: "team-pit" }, // black/gold
  { code: "MIA", label: "team-mia" }, // teal/orange
];

async function setFavTeam(context, code) {
  if (!code) return;
  await context.addCookies([
    {
      name: "nfl_fav_team",
      value: code,
      domain: "localhost",
      path: "/",
    },
  ]);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
  });

  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    // Default (no favorite team) pass.
    {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('input[name="password"]', PASSWORD);
      await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);

      for (const { path, name } of PAGES) {
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        await page.screenshot({
          path: `/tmp/screenshots/${name}-${vpName}.png`,
          fullPage: true,
        });
        console.log(`captured ${name}-${vpName}`);
      }
      await context.close();
    }

    // Favorite-team passes — only need the dashboard to show the theming.
    for (const { code, label } of TEAM_SCENARIOS) {
      const context = await browser.newContext({ viewport });
      await setFavTeam(context, code);
      const page = await context.newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('input[name="password"]', PASSWORD);
      await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);

      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: `/tmp/screenshots/dashboard-${label}-${vpName}.png`,
        fullPage: true,
      });
      console.log(`captured dashboard-${label}-${vpName}`);
      await context.close();
    }
  }

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
