#!/usr/bin/env node

/**
 * Scripted browser QA for the v2 editor (/v2).
 *
 *   QA_PASSWORD=... npm run qa:v2 -w @orest/web
 *
 * Environment:
 *   QA_BASE_URL     base URL of a running app (default http://127.0.0.1:3000)
 *   QA_PASSWORD     the app password (falls back to APP_PASSWORD); never printed
 *   QA_V2_PAID=1    also run ONE real `Структура` pass with accept and undo (costs model calls)
 *   QA_TIMEOUT_MS   per-step timeout (default 45000); QA_PAID_TIMEOUT_MS for the paid run (default 420000)
 *   HEADLESS=0      show the browser
 *
 * By default nothing here can cost anything: every request to a model-backed endpoint is aborted in the
 * browser before it leaves, and the script fails if one was even attempted. With `QA_V2_PAID=1` only the
 * review-run endpoint (`/api/edit/review`, start and polling) is let through; proposals, images, patches and
 * spellcheck stay blocked. The settings page checks the chosen model with a small real request every time
 * it opens (`/api/settings/validate`); the script always answers that request itself.
 * It works in a fresh, throwaway browser context, so no browser profile on this machine is read or changed,
 * and it never clears storage or deletes a database.
 */

import { chromium } from "playwright";

const baseUrl = (process.env.QA_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const password = process.env.QA_PASSWORD ?? process.env.APP_PASSWORD ?? "";
const paid = process.env.QA_V2_PAID === "1";
const timeoutMs = Number(process.env.QA_TIMEOUT_MS ?? 45000);
const paidTimeoutMs = Number(process.env.QA_PAID_TIMEOUT_MS ?? 420000);
const headless = !["0", "false", "no"].includes(String(process.env.HEADLESS ?? "").toLowerCase());

if (!password) {
  console.error("Missing password. Set QA_PASSWORD (or APP_PASSWORD).");
  process.exit(1);
}

const SAMPLE = [
  "Чому кава не замінює сон",
  "Протягом періоду неспання в позаклітинному просторі базальних відділів переднього мозку відбувається прогресивна акумуляція аденозину — нуклеозиду, що утворюється внаслідок гідролізу аденозинтрифосфату. Чим довше ми не спимо, тим більше його накопичується.",
  "Аденозин зв’язується з рецепторами A1 та A2A і пригнічує активність нейронів, які підтримують стан бадьорості. Саме через це до вечора ми відчуваємо дедалі сильнішу сонливість — вчені називають це тиском сну.",
  "Кофеїн є конкурентним антагоністом аденозинових рецепторів: його молекула структурно подібна до аденозину, тож вона займає рецептор, але не активує його. Втома нікуди не зникає — мозок просто тимчасово перестає її помічати.",
  "Важливо, що кофеїн виводиться з організму поступово, тому чашка кави по обіді може вплинути на нічний сон. Тим часом аденозин продовжує накопичуватися.",
  "Коли дія кофеїну завершується, накопичений аденозин одномоментно отримує доступ до вивільнених рецепторів, що маніфестує різким зниженням рівня бадьорості. У побуті це називають «кофеїновою ямою».",
  "Єдиний фізіологічний механізм елімінації аденозину — це сон. Під час глибокого сну його концентрація знижується до вихідного рівня, і вранці тиск сну починає рости з нуля."
].join("\n\n");

/** Endpoints that call a model (or a paid service). The router `/api/edit/local-action` is plain server logic. */
const PAID_PATHS = ["/api/edit/review", "/api/edit/patch", "/api/edit/spellcheck"];

const results = [];
const editRequests = [];
let modelChecksAnswered = 0;
let browser = null;
let page = null;
let failed = false;

async function step(name, run) {
  const started = Date.now();

  try {
    const detail = await run();
    results.push({ name, ok: true, ms: Date.now() - started, ...(detail === undefined ? {} : { detail }) });
  } catch (error) {
    failed = true;
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error).split("\n")[0].slice(0, 300) });
  }
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Waits for a condition in the page; a timeout names what was being waited for. */
async function until(what, fn, arg, timeout = timeoutMs) {
  try {
    await page.waitForFunction(fn, arg, { timeout });
  } catch {
    const toast = await page.evaluate(() => document.querySelector("[data-v2-toast]")?.textContent ?? "").catch(() => "");
    throw new Error(`timed out waiting for: ${what}${toast ? ` (message on screen: ${toast.slice(0, 160)})` : ""}`);
  }
}

const editor = () => page.locator('[role="textbox"][contenteditable="true"]');
const manuscriptText = async () => (await editor().innerText()).replace(/\s+/g, " ").trim();
const paidRequests = () => editRequests.filter((path) => PAID_PATHS.some((prefix) => path.startsWith(prefix)));
/** Paid requests the script stopped in the browser. In default mode any entry here fails the run. */
const blockedPaid = [];
/** Paid requests that were let through to the server (only possible with `QA_V2_PAID=1`). */
const sentPaid = [];
const draftOf = (locale) => page.evaluate((key) => window.localStorage.getItem(key), `orest-v2-draft-${locale}-v1`);

async function waitForSaved(text) {
  await page.waitForFunction(
    ({ key, text }) => (window.localStorage.getItem(key) ?? "").includes(text),
    { key: "orest-v2-draft-uk-v1", text },
    { timeout: timeoutMs }
  );
}

/** A person's pause between two keys. The editor reads a keyboard selection from the browser a moment after it changes. */
const KEY_PAUSE_MS = 80;

async function selectWords(count) {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Control+Shift+ArrowRight");
  }

  await page.waitForTimeout(KEY_PAUSE_MS);
}

/** Switches the app language on /settings the way a person does, once the page reacts to input. */
async function switchLocale(locale) {
  await page.goto(`${baseUrl}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app-language");
  await until("the settings page to become interactive", () => {
    const select = document.querySelector("#app-language");
    return Boolean(select && Object.keys(select).some((key) => key.startsWith("__reactProps")));
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.selectOption("#app-language", locale);
  await until(`the app locale to become ${locale}`, (expected) => window.localStorage.getItem("orest-active-locale-v1") === expected, locale);
}

async function openMore(item) {
  await page.click("[data-v2-more]");
  await page.click(`[data-more="${item}"]`);
}

try {
  browser = await chromium.launch({ headless });
  // A fresh context: its storage starts empty and is thrown away with it.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: "uk-UA" });
  page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());

    if (pathname.startsWith("/api/edit/")) {
      editRequests.push(pathname);
    }
  });
  // The settings page pings the chosen model when it opens. Answered here, the ping costs nothing.
  await context.route("**/api/settings/validate", async (route) => {
    modelChecksAnswered += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "qa:v2 answered the model check itself" }) });
  });
  // The guarantee: a paid endpoint is reached only when the paid run was asked for, and then only the review run.
  await context.route("**/api/edit/**", async (route) => {
    const { pathname } = new URL(route.request().url());

    if (!PAID_PATHS.some((prefix) => pathname.startsWith(prefix))) {
      await route.continue();
    } else if (paid && pathname === "/api/edit/review") {
      sentPaid.push(`${route.request().method()} ${pathname}`);
      await route.continue();
    } else {
      blockedPaid.push(`${route.request().method()} ${pathname}`);
      await route.abort("blockedbyclient");
    }
  });

  await step("login gate: /v2 without a session goes to the login page", async () => {
    await page.goto(`${baseUrl}/v2`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: timeoutMs * 2 });
    await page.waitForSelector("#auth-password", { timeout: timeoutMs * 2 });
    await page.fill("#auth-password", password);
    await Promise.all([page.waitForURL(/\/v2(?:$|\?)/, { timeout: timeoutMs * 2 }), page.locator('form button[type="submit"]').click()]);
  });

  await step("/v2 loads: manuscript, three tabs, nothing over the text, no request to a model", async () => {
    await editor().waitFor({ timeout: timeoutMs * 2 });
    const tabs = await page.locator('[role="tablist"] [role="tab"]').count();
    expect(tabs === 3, `expected 3 tabs, found ${tabs}`);
    expect((await page.locator("[data-selbar]").count()) === 0, "the selection composer is on the page without a selection");
    expect((await page.locator("[data-studio]").count()) === 0, "the studio is open on load");
    expect(paidRequests().length === 0, `requests on load: ${paidRequests().join(", ")}`);
    expect(await page.locator("[data-v2-history]").isEnabled(), "the history button is disabled");
  });

  await step("typing and formatting", async () => {
    await editor().click();
    await page.keyboard.type("Перший абзац рукопису для перевірки.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Другий абзац із словом аденозин і ще раз аденозин.");
    await page.keyboard.press("Home");
    await selectWords(2);
    await page.keyboard.press("Control+b");
    expect((await editor().locator("strong").count()) === 1, "Ctrl+B did not make the selection bold");
    expect((await editor().locator("p").count()) === 2, "Enter did not start a second paragraph");
    return { paragraphs: 2 };
  });

  await step("undo and redo", async () => {
    await page.keyboard.press("Control+z");
    expect((await editor().locator("strong").count()) === 0, "undo did not take the bold back");
    await page.waitForTimeout(KEY_PAUSE_MS);
    await page.keyboard.press("Control+Shift+z");
    expect((await editor().locator("strong").count()) === 1, "redo did not bring the bold back");
  });

  await step("reload keeps the text", async () => {
    await waitForSaved("Другий абзац");
    await page.reload({ waitUntil: "domcontentloaded" });
    await editor().waitFor();
    const text = await manuscriptText();
    expect(text.includes("Перший абзац рукопису") && text.includes("Другий абзац"), "the text is gone after a reload");
    expect((await editor().locator("strong").count()) === 1, "the formatting is gone after a reload");
    expect(paidRequests().length === 0, `requests after a reload: ${paidRequests().join(", ")}`);
  });

  await step("selection composer appears with a selection and goes with it; Alt+F10 reaches it from the keyboard", async () => {
    await editor().locator("p").nth(1).click();
    await page.keyboard.press("Home");
    await selectWords(3);
    await page.waitForSelector("[data-selbar]");
    await page.keyboard.press("Alt+F10");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-selbar]"))), "Alt+F10 did not move focus to the composer");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-quick")) === "shorten", "the arrow did not move to the next action");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="textbox"]'))), "Escape did not return to the text");
    expect((await page.locator("[data-selbar]").count()) === 1, "the composer went away while the selection is still there");
    await page.keyboard.press("ArrowRight");
    await page.waitForSelector("[data-selbar]", { state: "detached" });
  });

  await step("tabs: click and arrow keys", async () => {
    await page.click("#v2-tab-overview");
    expect((await page.getAttribute("#v2-tab-overview", "aria-selected")) === "true", "Огляд is not selected");
    await page.keyboard.press("ArrowRight");
    expect((await page.getAttribute("#v2-tab-edits", "aria-selected")) === "true", "the arrow did not open Правки");
    expect(await page.evaluate(() => document.activeElement?.id) === "v2-tab-edits", "focus did not follow the arrow");
    await page.keyboard.press("ArrowRight");
    expect((await page.getAttribute("#v2-tab-ask", "aria-selected")) === "true", "the arrow did not open Запит");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    expect((await page.getAttribute("#v2-tab-overview", "aria-selected")) === "true", "the arrows do not wrap");
  });

  await step("an illustration from the composer opens its studio without a single paid request", async () => {
    await editor().locator("p").nth(1).click();
    await page.keyboard.press("Home");
    await selectWords(3);
    await page.waitForSelector("[data-selbar]");
    await page.click('[data-selbar] [data-quick="visual"]');
    const card = page.locator('[data-card-kind="visual"]').first();
    await until("the illustration card in the queue", () => document.querySelector('[data-card-kind="visual"]') !== null);
    const before = paidRequests().length;
    await card.locator("[data-studio-open]").click();
    await page.waitForSelector("[data-studio]");
    await page.waitForSelector("[data-studio-prompt]");
    await page.waitForTimeout(600);
    expect(paidRequests().length === before && before === 0, `opening the studio sent: ${paidRequests().join(", ")}`);
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-studio]", { state: "detached" });
    return { router: editRequests.filter((path) => path === "/api/edit/local-action").length };
  });

  await step("find and replace: count, replace all, one undo, an honest nothing-found", async () => {
    await editor().locator("p").first().click();
    await page.keyboard.press("Control+h");
    await page.waitForSelector('[data-v2-dialog="replace"]');
    await page.keyboard.type("аденозин");
    await page.waitForSelector('[data-replace-status="ready"]');
    const counted = await page.locator("[data-replace-status]").innerText();
    expect(/2/.test(counted), `expected 2 matches, the dialog says: ${counted}`);
    await page.keyboard.press("Tab");
    await page.keyboard.type("кофеїн");
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-v2-dialog="replace"]', { state: "detached" });
    let text = await manuscriptText();
    expect(!text.includes("аденозин") && (text.match(/кофеїн/g) ?? []).length === 2, "replace all did not replace both matches");
    await editor().locator("p").first().click();
    await page.keyboard.press("Control+z");
    text = await manuscriptText();
    expect((text.match(/аденозин/g) ?? []).length === 2 && !text.includes("кофеїн"), "one undo did not take the whole replacement back");
    await page.keyboard.press("Control+Shift+z");
    await page.keyboard.press("Control+h");
    await page.waitForSelector('[data-v2-dialog="replace"]');
    await page.keyboard.type("такогословатутнемає");
    await page.waitForSelector('[data-replace-status="none"]');
    expect(await page.locator("[data-replace-action]").isDisabled(), "replace is offered when nothing was found");
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-v2-dialog="replace"]', { state: "detached" });
  });

  await step("history lists the replacement and opens its before/after", async () => {
    await page.click("[data-v2-history]");
    await page.waitForSelector('[data-v2-dialog="history"]');
    const entries = await page.locator("[data-history-entry]").count();
    expect(entries >= 1, "the replacement is not in the history");
    await page.locator('[data-history-entry="globalReplace"]').first().click();
    await page.waitForSelector("[data-history-compare]");
    const before = await page.locator('[data-history-side="before"]').innerText();
    const after = await page.locator('[data-history-side="after"]').innerText();
    expect(before.includes("аденозин") && after.includes("кофеїн"), "the comparison does not show what changed");
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-v2-dialog="history"]', { state: "detached" });
    return { entries };
  });

  await step("export: .txt and .docx", async () => {
    await page.click("[data-v2-export]");
    const [txt] = await Promise.all([page.waitForEvent("download"), page.click('[data-export="txt"]')]);
    expect(txt.suggestedFilename().endsWith(".txt"), `unexpected file name ${txt.suggestedFilename()}`);
    const stream = await txt.createReadStream();
    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks).toString("utf8").includes("Перший абзац рукопису"), "the exported text does not contain the manuscript");
    await page.click("[data-v2-export]");
    const [docx] = await Promise.all([page.waitForEvent("download"), page.click('[data-export="docx"]')]);
    expect(docx.suggestedFilename().endsWith(".docx"), `unexpected file name ${docx.suggestedFilename()}`);
    return { txt: txt.suggestedFilename(), docx: docx.suggestedFilename() };
  });

  await step("clear document: asks first, cancel keeps everything, confirm clears, the session can bring it back", async () => {
    await openMore("clear");
    await page.waitForSelector('[data-v2-dialog="confirm-clear"]');
    expect((await manuscriptText()).includes("Перший абзац"), "the text was cleared before the confirmation");
    await page.click("[data-confirm-cancel]");
    await page.waitForSelector('[data-v2-dialog="confirm-clear"]', { state: "detached" });
    expect((await manuscriptText()).includes("Перший абзац"), "cancel cleared the text");
    await openMore("clear");
    await page.click("[data-confirm-action]");
    await until("the manuscript to be empty after the clear", () => (document.querySelector('[role="textbox"]')?.textContent ?? "").trim() === "");
    expect((await page.locator("[data-card]").count()) === 0, "suggestions survived the clear");
    await openMore("restore");
    await until("the text to come back", () => (document.querySelector('[role="textbox"]')?.textContent ?? "").includes("Перший абзац"));
    expect((await page.locator('[data-card-kind="visual"]').count()) === 1, "the suggestion did not come back with the text");
    await page.click("[data-v2-history]");
    await page.waitForSelector("[data-history-entry]");
    await page.keyboard.press("Escape");
  });

  await step("open a file: asks before replacing a manuscript, then imports it", async () => {
    await page.click("[data-v2-open]");
    await page.click('[data-open="file"]');
    await page.waitForSelector('[data-v2-dialog="confirm-open"]');
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-confirm-action]")]);
    await chooser.setFiles({ name: "qa-chapter.txt", mimeType: "text/plain", buffer: Buffer.from(SAMPLE, "utf8") });
    await until("the imported text", () => (document.querySelector('[role="textbox"]')?.textContent ?? "").includes("кофеїновою ямою"));
    const paragraphs = await editor().locator("p").count();
    expect(paragraphs >= 6, `expected the six sample paragraphs, found ${paragraphs}`);
    expect(!(await manuscriptText()).includes("Перший абзац рукопису"), "the old text is still there");
    await waitForSaved("кофеїновою ямою");
    expect((await page.locator("[data-v2-toast] [data-toast-action]").count()) === 1, "the message about the import offers no way back");
    return { paragraphs };
  });

  await step("locale: English on /settings shows /v2 in English with its own draft; back to Ukrainian brings the text back", async () => {
    await switchLocale("en");
    await page.goto(`${baseUrl}/v2`, { waitUntil: "domcontentloaded" });
    await editor().waitFor();
    expect((await page.locator("#v2-tab-edits").innerText()).includes("Edits"), "the tabs are not in English");
    expect((await editor().getAttribute("lang")) === "en", "the manuscript is not marked as English");
    expect(!(await manuscriptText()).includes("кофеїновою"), "the English draft shows the Ukrainian text");
    await editor().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("An English paragraph.");
    await until("the English draft to be saved under its own key", () => (window.localStorage.getItem("orest-v2-draft-en-v1") ?? "").includes("An English paragraph."));
    expect(((await draftOf("uk")) ?? "").includes("кофеїновою ямою"), "the Ukrainian draft was changed by the English one");
    await switchLocale("uk");
    await page.goto(`${baseUrl}/v2`, { waitUntil: "domcontentloaded" });
    await editor().waitFor();
    expect((await page.locator("#v2-tab-edits").innerText()).includes("Правки"), "the tabs are not back in Ukrainian");
    expect((await manuscriptText()).includes("кофеїновою ямою"), "the Ukrainian draft did not come back");
  });

  await step("nothing in the free flows reached a model", async () => {
    expect(paidRequests().length === 0, `paid requests attempted: ${paidRequests().join(", ")}`);
    expect(blockedPaid.length === 0 && sentPaid.length === 0, `paid requests attempted: ${[...blockedPaid, ...sentPaid].join(", ")}`);
    return { router: editRequests.length, paidAttempted: 0, modelChecksAnsweredByTheScript: modelChecksAnswered };
  });

  if (paid) {
    await step("PAID: one real Структура pass, accept a heading, undo it", async () => {
      await page.click("#v2-tab-edits");
      const row = page.locator('[data-pass="structure"]');
      await row.locator("button").first().click();
      await until("the pass to start", () => document.querySelector('[data-pass="structure"]')?.getAttribute("data-pass-state") !== "idle");
      await until(
        "the pass to finish",
        () => {
          const state = document.querySelector('[data-pass="structure"]')?.getAttribute("data-pass-state");
          return state === "done" || state === "failed";
        },
        null,
        paidTimeoutMs
      );
      const state = await row.getAttribute("data-pass-state");
      expect(state === "done", `the pass ended as "${state}": ${(await row.innerText()).replace(/\s+/g, " ").slice(0, 240)}`);
      const cards = page.locator('[data-card-kind="heading"]');
      const count = await cards.count();
      expect(count > 0, "the pass finished without a single heading suggestion");
      const headingsBefore = await editor().locator("h2, h3").count();
      await cards.first().click();
      await cards.first().locator("button").last().click();
      await until("the accepted heading in the text", (before) => document.querySelectorAll('[role="textbox"] h2, [role="textbox"] h3').length === before + 1, headingsBefore);
      await editor().locator("p").first().click();
      await page.keyboard.press("Control+z");
      await until("undo to take the heading out", (before) => document.querySelectorAll('[role="textbox"] h2, [role="textbox"] h3').length === before, headingsBefore);
      await until("the suggestion to be open again", (expected) => document.querySelectorAll('[data-card-kind="heading"]').length === expected, count);
      return { headings: count, reviewRequests: editRequests.filter((path) => path.startsWith("/api/edit/review")).length };
    });
  }

  await step("log out", async () => {
    const response = await context.request.post(`${baseUrl}/api/auth/logout`);
    expect(response.status() < 500, `logout answered ${response.status()}`);
  });
} catch (error) {
  failed = true;
  results.push({ name: "unexpected", ok: false, error: String(error?.message ?? error).split("\n")[0].slice(0, 300) });
} finally {
  await browser?.close();
}

if (!paid && (blockedPaid.length > 0 || sentPaid.length > 0)) {
  failed = true;
}

console.log(JSON.stringify({ baseUrl, paid, paidRequestsAttempted: blockedPaid.length + sentPaid.length, paidRequestsBlocked: blockedPaid, paidRequestsSent: sentPaid.length, modelChecksAnsweredByTheScript: modelChecksAnswered, passed: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length, results }, null, 2));
process.exit(failed ? 1 : 0);
