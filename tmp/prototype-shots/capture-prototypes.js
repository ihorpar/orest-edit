const { chromium } = require("playwright");

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const base = "http://127.0.0.1:4173";

  async function open(path) {
    await page.goto(`${base}/${path}`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
  }

  async function shot(name) {
    await page.screenshot({ path: `tmp/prototype-shots/${name}.png`, fullPage: false });
  }

  await open("floating_panel_concept_command_palette.html");
  await shot("concept1-default");
  await page.getByRole("button", { name: /Орфографія/i }).click();
  await page.waitForTimeout(200);
  await shot("concept1-spellcheck");
  await page.getByRole("button", { name: /Візуал/i }).click();
  await page.waitForTimeout(200);
  await shot("concept1-visual");

  await open("floating_panel_concept_intent_first.html");
  await shot("concept2-text");
  await page.getByRole("button", { name: /Орфографія/i }).click();
  await page.waitForTimeout(200);
  await shot("concept2-spellcheck");
  await page.getByRole("button", { name: /Візуал/i }).click();
  await page.waitForTimeout(200);
  await shot("concept2-visual");

  await open("floating_panel_concept_smart_confirm.html");
  await shot("concept3-default");
  await page.locator("#prompt").fill("зроби тут якусь штуку з цим фрагментом");
  await page.waitForTimeout(250);
  await shot("concept3-unclear");
  await page.locator("#prompt").fill("підготуй візуал про три етапи");
  await page.waitForTimeout(250);
  await shot("concept3-visual");

  await open("floating_panel_options.html");
  await shot("legacy-default-patch");
  await page.getByRole("button", { name: /Правопис/i }).click();
  await page.waitForTimeout(250);
  await shot("legacy-spellcheck");
  await page.getByRole("button", { name: /Врізка/i }).click();
  await page.waitForTimeout(250);
  await shot("legacy-callout");
  await page.getByRole("button", { name: /Візуал/i }).click();
  await page.waitForTimeout(250);
  await shot("legacy-visual");

  await browser.close();
}

capture().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
