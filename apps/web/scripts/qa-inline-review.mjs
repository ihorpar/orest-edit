#!/usr/bin/env node

import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));

const baseUrl = args.url ?? process.env.QA_BASE_URL ?? "http://127.0.0.1:3100";
const password = args.password ?? process.env.QA_PASSWORD ?? process.env.APP_PASSWORD ?? "";
const screenshotPath = args.screenshot ?? process.env.QA_SCREENSHOT_PATH ?? "/tmp/inline-review-qa.png";
const noScreenshot = Boolean(args["no-screenshot"]);
const timeoutMs = Number(args.timeout ?? process.env.QA_TIMEOUT_MS ?? 45000);

if (!password) {
  console.error("Missing password. Pass --password=... or set QA_PASSWORD/APP_PASSWORD.");
  process.exit(1);
}

const summary = {
  redirectedToLogin: false,
  loggedInToEditor: false,
  selectedBlocks: 0,
  anchorRows: 0,
  startEdges: 0,
  endEdges: 0,
  inlineCards: 0,
  calloutDraftReady: false,
  visualPromptReady: false,
  visualInlineCards: 0,
  screenshotPath: noScreenshot ? null : screenshotPath
};

let browser = null;
let page = null;

try {
  browser = await chromium.launch({ headless: !isFalsey(process.env.HEADLESS) });
  page = await browser.newPage({ viewport: { width: 1720, height: 980 } });

  await page.goto(`${baseUrl}/editor`, { waitUntil: "networkidle" });
  summary.redirectedToLogin = page.url().includes("/login");

  if (summary.redirectedToLogin) {
    await page.waitForSelector("#auth-password", { timeout: timeoutMs * 2 });
    await page.fill("#auth-password", password);
    await Promise.all([
      page.waitForURL("**/editor", { timeout: timeoutMs }),
      page.getByRole("button", { name: "Увійти" }).click()
    ]);
  }

  summary.loggedInToEditor = page.url().includes("/editor");
  await page.waitForLoadState("networkidle", { timeout: timeoutMs });
  await page.waitForSelector(".block-editor-row", { timeout: timeoutMs * 2 });

  const gutters = page.locator(".block-editor-gutter");
  await gutters.nth(1).click();
  await gutters.nth(2).click({ modifiers: ["Shift"] });
  summary.selectedBlocks = await page.locator('.block-editor-row[data-selected="true"]').count();

  if (!(await page.locator('.floating-panel[data-mode="local"]').isVisible())) {
    const localSection = page.locator("section.rail-section.rail-section-primary").filter({ hasText: "Локальна правка" });
    await localSection.getByRole("button", { name: "Відкрити" }).click();
    await page.waitForSelector('.floating-panel[data-mode="local"]', { timeout: timeoutMs });
  }

  await page.locator('.floating-panel[data-mode="local"]').getByRole("button", { name: "Врізка" }).click();
  await page.getByRole("button", { name: "Згенерувати врізку" }).click();
  await page.waitForSelector('.editorial-review-detail[data-layout="pendant"][data-type="callout"]', { timeout: timeoutMs });

  summary.inlineCards = await page.locator('.editorial-review-detail[data-layout="pendant"]').count();
  summary.anchorRows = await page.locator('.block-editor-row[data-review-anchor="true"]').count();
  summary.startEdges = await page.locator('.block-editor-row[data-review-anchor-edge="start"]').count();
  summary.endEdges = await page.locator('.block-editor-row[data-review-anchor-edge="end"]').count();

  const calloutDraft = await page.locator(".editorial-review-callout-body-input").first().inputValue();
  summary.calloutDraftReady = calloutDraft.trim().length > 0;

  await gutters.nth(1).click();
  await gutters.nth(2).click({ modifiers: ["Shift"] });
  await page.locator('.floating-panel[data-mode="local"]').getByRole("button", { name: "Візуал" }).click();
  await page.getByRole("button", { name: "Згенерувати візуал" }).click();
  await page.waitForSelector('.editorial-review-detail[data-layout="pendant"][data-type="visual"] textarea.editorial-review-image-prompt-input', { timeout: timeoutMs });

  const visualPrompt = await page.locator("textarea.editorial-review-image-prompt-input").first().inputValue();
  summary.visualPromptReady = visualPrompt.trim().length > 0;
  summary.visualInlineCards = await page.locator('.editorial-review-detail[data-layout="pendant"][data-type="visual"]').count();

  if (!noScreenshot) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }

  console.log(JSON.stringify(summary, null, 2));

  const isValid =
    summary.redirectedToLogin &&
    summary.loggedInToEditor &&
    summary.selectedBlocks >= 2 &&
    summary.inlineCards === 1 &&
    summary.anchorRows >= 2 &&
    summary.startEdges === 1 &&
    summary.endEdges === 1 &&
    summary.calloutDraftReady &&
    summary.visualPromptReady &&
    summary.visualInlineCards === 1;

  if (!isValid) {
    console.error("Inline review QA failed.");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (!noScreenshot && page) {
    try {
      const errorPath = screenshotPath.endsWith(".png")
        ? screenshotPath.replace(/\.png$/i, "-error.png")
        : `${screenshotPath}-error.png`;
      await page.screenshot({ path: errorPath, fullPage: true });
      summary.screenshotPath = errorPath;
    } catch {
      // Ignore screenshot failures in error path.
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exit(1);
} finally {
  await browser?.close();
}

function parseArgs(argv) {
  return argv.reduce((acc, token) => {
    if (!token.startsWith("--")) {
      return acc;
    }

    const withoutPrefix = token.slice(2);
    const separatorIndex = withoutPrefix.indexOf("=");

    if (separatorIndex === -1) {
      acc[withoutPrefix] = true;
      return acc;
    }

    const key = withoutPrefix.slice(0, separatorIndex);
    const value = withoutPrefix.slice(separatorIndex + 1);
    acc[key] = value;
    return acc;
  }, {});
}

function isFalsey(value) {
  if (!value) {
    return false;
  }

  const lowered = String(value).trim().toLowerCase();
  return lowered === "0" || lowered === "false" || lowered === "no";
}
