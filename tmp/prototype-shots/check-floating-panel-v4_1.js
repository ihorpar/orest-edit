const { chromium } = require("playwright");

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  await page.goto("http://127.0.0.1:4173/floating_panel_options_v4_1.html", { waitUntil: "networkidle" });

  const state = await page.evaluate(() => ({
    activeTab: document.querySelector(".bridge-tab.active")?.textContent?.trim() ?? null,
    activeDetail:
      Array.from(document.querySelectorAll(".bridge-detail")).find((element) => getComputedStyle(element).display !== "none")?.id ?? null,
    topbar: Boolean(document.querySelector(".topbar")),
    manuscript: Boolean(document.querySelector(".manuscript-card"))
  }));

  await page.screenshot({ path: "tmp/prototype-shots/floating_panel_options_v4_1.png", fullPage: false });
  console.log(JSON.stringify(state));
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
