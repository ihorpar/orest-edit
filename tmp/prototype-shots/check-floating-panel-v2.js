const { chromium } = require("playwright");

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const readActiveState = () =>
    page.evaluate(() => {
      const activeTab = document.querySelector(".bridge-tab.active")?.textContent?.trim() ?? null;
      const activeDetail =
        Array.from(document.querySelectorAll(".bridge-detail")).find((element) => getComputedStyle(element).display !== "none")?.id ?? null;
      return { activeTab, activeDetail };
    });

  await page.goto("http://127.0.0.1:4173/floating_panel_options_v2.html", { waitUntil: "networkidle" });
  await page.locator("#auto-prompt").fill("зроби тут якусь штуку");
  const clarifyVisibleDefault = await page.locator("#auto-clarify-wrap").evaluate((element) => getComputedStyle(element).display !== "none");
  const ambiguousLabel = await page.locator("#auto-submit-label").innerText();

  await page.locator("#auto-prompt").fill("");
  await page.getByRole("button", { name: /Скоротити/i }).click();
  const shortenLabel = await page.locator("#auto-submit-label").innerText();

  await page.locator("#auto-prompt").fill("перший рядок\nдругий рядок\nтретій рядок\nчетвертий рядок");
  const textareaHeight = await page.locator("#auto-prompt").evaluate((element) => element.clientHeight);

  await page.locator("#auto-prompt").fill("підготуй візуал про три етапи");
  const autoVisualVisible = await page.locator("#auto-visual-state").evaluate((element) => getComputedStyle(element).display !== "none");
  const autoVisualLabel = await page.locator("#auto-submit-label").innerText();
  const autoActiveToggleAfterVisual = await page.locator("#auto-intents .toggle-opt.active").allInnerTexts();

  await page.getByRole("button", { name: /^Візуал$/i }).click();
  const dedicatedVisualDescription = await page.locator("#visual-description").innerText();
  await page.getByRole("button", { name: /^Врізка$/i }).click();
  const dedicatedCalloutDescription = await page.locator("#callout-description").innerText();

  const stateBeforeEditorClick = await readActiveState();
  await page.getByRole("button", { name: /^Редактор$/i }).click();
  const stateAfterEditorClick = await readActiveState();
  await page.screenshot({ path: "tmp/prototype-shots/floating_panel_options_v2-current.png", fullPage: false });

  const result = {
    title: await page.title(),
    clarifyVisibleDefault,
    ambiguousLabel,
    shortenLabel,
    actionLabel: await page.locator("#auto-submit-label").innerText(),
    textareaHeight,
    autoVisualVisible,
    autoVisualLabel,
    autoActiveToggleAfterVisual,
    dedicatedVisualDescription,
    dedicatedCalloutDescription,
    stateBeforeEditorClick,
    stateAfterEditorClick
  };

  console.log(JSON.stringify(result));
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
