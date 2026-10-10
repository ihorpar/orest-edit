import test from "node:test";
import assert from "node:assert/strict";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialReviewItem, GeneratedReviewImageAsset } from "../lib/editor/review-contract.ts";
import { DEFAULT_IMAGE_PROMPT_TEMPLATE, sanitizeEditorSettings } from "../lib/editor/settings.ts";
import { buildLocalActionRequest } from "../lib/v2/fragment-actions.ts";
import {
  buildImageRequest,
  buildVisualProposalRequest,
  generateImage,
  IMAGE_MAX_BYTES,
  IMAGE_REQUEST_TIMEOUT_MS,
  interpretImageReply,
  interpretVisualPromptReply,
  requestVisualPrompt,
  REVIEW_IMAGE_ENDPOINT,
  storeGeneratedAsset,
  type AssetStoreDeps,
  type VisualApiMessages
} from "../lib/v2/visual-api.ts";

const messages: VisualApiMessages = {
  network: "Немає з’єднання.",
  promptInvalid: "Відповідь не є промптом.",
  promptEmpty: "Модель повернула порожню відповідь.",
  imageInvalid: "Відповідь не є результатом генерування.",
  imageEmpty: "Генерування завершилося без зображення.",
  imageTimeout: "Модель зображень не відповіла вчасно.",
  assetFailed: "Не вдалося зберегти зображення."
};

const paragraph = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });
const document: EditorDocument = {
  version: 2,
  blocks: [
    paragraph("p-1", "Аденозин накопичується, поки ми не спимо."),
    paragraph("p-2", "Кофеїн є конкурентним антагоністом аденозинових рецепторів."),
    paragraph("p-3", "Коли дія кофеїну завершується, втома повертається.")
  ]
};
const revision = deriveManuscriptRevisionState(document);
const settings = sanitizeEditorSettings(null, "uk");

const item: EditorialReviewItem = {
  id: "v-1",
  reviewSessionId: "session-1",
  documentRevisionId: revision.documentRevisionId,
  changeLevel: 5,
  title: "Кофеїн займає місце аденозину",
  reason: "Механізм легше побачити.",
  recommendation: "Показати рецептор у два кадри.",
  recommendationType: "visual",
  suggestedAction: "prepare_visual",
  priority: "medium",
  anchor: { blockIds: ["p-2"], generationBlockRange: { start: 1, end: 1 }, excerpt: "Кофеїн є…", fingerprint: computeAnchorFingerprint(document, ["p-2"]) },
  insertionPoint: { mode: "after", anchorBlockId: "p-2" },
  origin: "review",
  stepId: "visuals",
  stepRunId: "run-1",
  status: "pending",
  visualIntent: "infographic"
};

/* ---------- request bodies ---------- */

test("the image prompt request is the classic editor's: compact item, anchored blocks, template, style and speed", () => {
  const request = buildVisualProposalRequest({ document, item, settings, locale: "uk", intent: "illustration", style: "neo_brutal", quality: "fast" });

  // Field for field what `buildReviewActionRequestBody` in app/editor/page.tsx sends for `prepare_visual`.
  assert.deepEqual(request, {
    document: { version: 2, blocks: [document.blocks[1]] },
    currentRevision: {
      documentRevisionId: revision.documentRevisionId,
      blockOrder: ["p-2"],
      blockFingerprints: { "p-2": revision.blockFingerprints["p-2"] }
    },
    item: {
      id: "v-1",
      reviewSessionId: "session-1",
      documentRevisionId: revision.documentRevisionId,
      changeLevel: 5,
      title: "Кофеїн займає місце аденозину",
      reason: "Механізм легше побачити.",
      recommendation: "Показати рецептор у два кадри.",
      recommendationType: "visual",
      suggestedAction: "prepare_visual",
      priority: "medium",
      anchor: item.anchor,
      insertionPoint: item.insertionPoint,
      status: "pending",
      visualIntent: "illustration"
    },
    editorialInstruction: undefined,
    provider: settings.provider,
    modelId: settings.modelId,
    locale: "uk",
    imagePromptTemplate: DEFAULT_IMAGE_PROMPT_TEMPLATE,
    visualStylePreset: "neo_brutal",
    imageQuality: "fast"
  });
});

test("the request carries the intent chosen in the studio, and both anchors when the image goes after another block", () => {
  const moved: EditorialReviewItem = { ...item, visualIntent: "illustration", insertionPoint: { mode: "after", anchorBlockId: "p-3" } };
  const request = buildVisualProposalRequest({ document, item: moved, settings, locale: "uk", intent: "infographic", style: "minimal", quality: "quality" });

  assert.equal(request.item.visualIntent, "infographic", "the studio's choice, not the one the item arrived with");
  assert.deepEqual(request.currentRevision.blockOrder, ["p-2", "p-3"]);
  assert.deepEqual(request.document.blocks.map((block) => block.id), ["p-2", "p-3"]);
  assert.equal(request.imageQuality, "quality");
  assert.equal(request.basePrompt, undefined);
  assert.equal(request.calloutPromptTemplate, undefined);
});

test("a hand-made illustration item is sent as a visual whatever it carried", () => {
  const manual = { ...item, origin: "manual" as const, stepId: undefined, suggestedAction: "insert_text" as const };
  const request = buildVisualProposalRequest({ document, item: manual, settings, locale: "uk", intent: "infographic", style: "minimal", quality: "fast" });

  assert.equal(request.item.suggestedAction, "prepare_visual");
  assert.equal(request.imagePromptTemplate, settings.imagePromptTemplate);
});

test("the image request is the classic editor's body exactly: locale, prompt, speed, and no job flag", () => {
  // `generateActiveReviewImage` in app/editor/page.tsx posts { locale, prompt, imageQuality } and reads the
  // image from the same response. A job (`async`) is never asked for.
  const body = buildImageRequest({ prompt: "  Схема рецептора.  ", quality: "fast", locale: "uk" });

  assert.deepEqual(body, { locale: "uk", prompt: "Схема рецептора.", imageQuality: "fast" });
  assert.equal("async" in body, false);
  assert.equal(buildImageRequest({ prompt: "x", quality: "quality", locale: "en" }).imageQuality, "quality");
});

test("the composer's request to the router carries the illustration style, as in the classic editor", () => {
  assert.equal(buildLocalActionRequest({ action: "visual", locale: "uk", visualStylePreset: "modern_glass" }).visualStylePreset, "modern_glass");
  assert.equal(buildLocalActionRequest({ action: "visual", locale: "uk", visualStylePreset: "modern_glass" }).explicitMode, "visual");
  assert.equal("visualStylePreset" in buildLocalActionRequest({ action: "visual", locale: "uk" }), false);
});

/* ---------- the prompt reply ---------- */

const requested = { intent: "illustration" as const, style: "neo_brutal" as const, quality: "fast" as const };
const promptPayload = (imageDraft: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    proposal: { id: "proposal-image-1", reviewItemId: "v-1", kind: "image_prompt", summary: "", canApplyDirectly: false, imageDraft },
    providerUsed: "openai",
    usedFallback: false,
    diagnostics: { rawOutput: '{"prompt":"…"}' },
    ...extra
  });

test("a prepared prompt is read with its alt text, caption and the settings the server echoed", () => {
  const reply = interpretVisualPromptReply(
    promptPayload({ visualIntent: "illustration", visualStylePreset: "neo_brutal", imageQuality: "fast", prompt: " Сцена за столом. ", alt: "Людина і кава", caption: "Втома повертається.", targetModel: "x" }),
    200,
    messages,
    requested
  );

  assert.deepEqual(reply, { kind: "prompt", prompt: "Сцена за столом.", alt: "Людина і кава", caption: "Втома повертається.", intent: "illustration", style: "neo_brutal", quality: "fast" });
});

test("fail loud at the prompt: server error, missing draft, empty prompt, unreadable reply, stale anchor", () => {
  assert.deepEqual(
    interpretVisualPromptReply(JSON.stringify({ proposal: { kind: "image_prompt", summary: "Немає OPENAI_API_KEY." }, error: "Немає OPENAI_API_KEY." }), 200, messages, requested),
    { kind: "error", message: "Немає OPENAI_API_KEY.", httpStatus: 200 }
  );
  assert.deepEqual(interpretVisualPromptReply(JSON.stringify({ error: "Потрібна авторизація." }), 401, messages, requested), {
    kind: "error",
    message: "Потрібна авторизація.",
    httpStatus: 401
  });
  assert.deepEqual(interpretVisualPromptReply("<html>504</html>", 504, messages, requested), { kind: "error", message: "Відповідь не є промптом. (HTTP 504)", httpStatus: 504 });
  assert.equal(interpretVisualPromptReply(promptPayload({ prompt: "   ", alt: "x" }), 200, messages, requested).kind, "error");
  assert.equal(interpretVisualPromptReply(JSON.stringify({ proposal: { kind: "image_prompt" } }), 200, messages, requested).kind, "error");
  // A proposal of another kind is not a prompt.
  assert.deepEqual(interpretVisualPromptReply(JSON.stringify({ proposal: { kind: "callout_prompt", calloutDraft: { previewText: "x" } } }), 200, messages, requested), {
    kind: "error",
    message: "Відповідь не є промптом.",
    httpStatus: 200
  });
  assert.deepEqual(interpretVisualPromptReply(JSON.stringify({ proposal: { kind: "stale_anchor", staleReason: "Фрагмент змінено." } }), 200, messages, requested), {
    kind: "stale_anchor",
    message: "Фрагмент змінено."
  });
});

test("the server's stand-in prompt for an empty model answer is not shown as the model's prompt", () => {
  const reply = interpretVisualPromptReply(promptPayload({ prompt: "Запасний текст сервера", alt: "x", caption: "" }, { diagnostics: { rawOutput: "  " } }), 200, messages, requested);

  assert.deepEqual(reply, { kind: "error", message: "Модель повернула порожню відповідь.", httpStatus: 200 });
});

test("requestVisualPrompt posts the request once and reports a network failure in words", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const request = buildVisualProposalRequest({ document, item, settings, locale: "uk", intent: "infographic", style: "minimal", quality: "fast" });
  const ok = await requestVisualPrompt(request, {
    messages,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(promptPayload({ prompt: "Схема", alt: "Схема", caption: "" }), { status: 200 });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "/api/edit/review/proposal");
  assert.deepEqual(calls[0]!.body, JSON.parse(JSON.stringify(request)));
  assert.deepEqual(ok, { kind: "prompt", prompt: "Схема", alt: "Схема", caption: "", intent: "infographic", style: "minimal", quality: "fast" });

  const failed = await requestVisualPrompt(request, { messages, fetchImpl: async () => Promise.reject(new TypeError("Failed to fetch")) });
  assert.deepEqual(failed, { kind: "error", message: "Немає з’єднання. Failed to fetch" });
});

/* ---------- generating the image ---------- */

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const dataAsset: GeneratedReviewImageAsset = { assetId: "asset-image-1", mimeType: "image/png", source: { kind: "data_url", dataUrl: PNG } };
const body = (payload: Record<string, unknown>) => JSON.stringify({ providerUsed: "gemini", modelId: "gemini-3.1-flash-lite-image", ...payload });
const request = buildImageRequest({ prompt: "Схема", quality: "fast", locale: "uk" });

test("the image answer is an image or a failure, and a server error always wins", () => {
  assert.deepEqual(interpretImageReply(body({ asset: dataAsset }), 200, messages), { kind: "image", asset: dataAsset });

  assert.deepEqual(interpretImageReply(body({ error: "Gemini image повернув статус 429." }), 400, messages), {
    kind: "failed",
    message: "Gemini image повернув статус 429.",
    httpStatus: 400
  });
  assert.deepEqual(interpretImageReply(body({ error: "Порожній image prompt." }), 400, messages), { kind: "failed", message: "Порожній image prompt.", httpStatus: 400 });
  assert.deepEqual(interpretImageReply(JSON.stringify({ error: "Потрібна авторизація." }), 401, messages), { kind: "failed", message: "Потрібна авторизація.", httpStatus: 401 });
  assert.equal(interpretImageReply(body({ asset: dataAsset, error: "x" }), 200, messages).kind, "failed", "an error is never passed over");
});

test("an answer without an image is a failure in plain words, never an empty success", () => {
  assert.deepEqual(interpretImageReply(body({}), 200, messages), { kind: "failed", message: "Генерування завершилося без зображення.", httpStatus: 200 });
  // A queued job is not an image: this client never asks for one and does not wait on one.
  assert.deepEqual(interpretImageReply(body({ job: { id: "review-image-job-1", status: "queued", pollAfterMs: 900 } }), 202, messages), {
    kind: "failed",
    message: "Генерування завершилося без зображення.",
    httpStatus: 202
  });
  assert.deepEqual(interpretImageReply("<html>Bad gateway</html>", 502, messages), { kind: "failed", message: "Відповідь не є результатом генерування. (HTTP 502)", httpStatus: 502 });
  assert.deepEqual(interpretImageReply(body({ asset: dataAsset }), 500, messages), { kind: "failed", message: "Відповідь не є результатом генерування. (HTTP 500)", httpStatus: 500 });
  // An image without a usable source or without an id is not an image.
  assert.equal(interpretImageReply(body({ asset: { assetId: "a", mimeType: "image/png", source: { kind: "data_url", dataUrl: " " } } }), 200, messages).kind, "failed");
  assert.equal(interpretImageReply(body({ asset: { assetId: "", mimeType: "image/png", source: dataAsset.source } }), 200, messages).kind, "failed");
});

test("generateImage posts once to the image endpoint and returns the image from that same response", async () => {
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  const reply = await generateImage(request, {
    messages,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
      return new Response(body({ asset: dataAsset }), { status: 200 });
    }
  });

  assert.deepEqual(calls, [{ url: REVIEW_IMAGE_ENDPOINT, method: "POST", body: { locale: "uk", prompt: "Схема", imageQuality: "fast" } }]);
  assert.deepEqual(reply, { kind: "image", asset: dataAsset });
});

test("a provider failure and a lost connection are reported in words", async () => {
  assert.deepEqual(
    await generateImage(request, { messages, fetchImpl: async () => new Response(body({ error: "Gemini не відповів вчасно під час генерації зображення." }), { status: 400 }) }),
    { kind: "failed", message: "Gemini не відповів вчасно під час генерації зображення.", httpStatus: 400 }
  );
  assert.deepEqual(await generateImage(request, { messages, fetchImpl: async () => Promise.reject(new TypeError("Failed to fetch")) }), {
    kind: "failed",
    message: "Немає з’єднання. Failed to fetch"
  });
});

/** A fetch that never answers until its signal is aborted, as a hung request does. */
const hanging = (seen: { signal?: AbortSignal | null }) => (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    seen.signal = init?.signal;
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

test("timeout: a request that never answers is given up on a little above the route's limit, with a real message", async () => {
  const seen: { signal?: AbortSignal | null } = {};
  const timers: Array<{ handler: () => void; ms: number }> = [];
  let cleared = 0;
  const pending = generateImage(request, {
    messages,
    fetchImpl: hanging(seen),
    setTimer: (handler, ms) => {
      timers.push({ handler, ms });
      return timers.length;
    },
    clearTimer: () => {
      cleared += 1;
    }
  });

  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.ms, IMAGE_REQUEST_TIMEOUT_MS);
  assert.ok(IMAGE_REQUEST_TIMEOUT_MS > 60_000 && IMAGE_REQUEST_TIMEOUT_MS <= 90_000, "above the route's 60 s, not open-ended");

  timers[0]!.handler();

  assert.deepEqual(await pending, { kind: "failed", message: "Модель зображень не відповіла вчасно." });
  assert.equal(seen.signal?.aborted, true, "the request itself is aborted");
  assert.equal(cleared, 1);
});

test("cancel: aborting stops the wait without a result and without an error", async () => {
  const seen: { signal?: AbortSignal | null } = {};
  const controller = new AbortController();
  const pending = generateImage(request, { messages, fetchImpl: hanging(seen), signal: controller.signal, setTimer: () => 0, clearTimer: () => undefined });

  controller.abort();

  assert.deepEqual(await pending, { kind: "aborted" });
  assert.equal(seen.signal?.aborted, true);

  // Already cancelled before it was sent: nothing leaves the browser.
  let sent = 0;
  const early = await generateImage(request, {
    messages,
    signal: controller.signal,
    fetchImpl: async () => {
      sent += 1;
      return new Response(body({ asset: dataAsset }), { status: 200 });
    }
  });
  assert.deepEqual(early, { kind: "aborted" });
  assert.equal(sent, 0);
});

/* ---------- the asset store ---------- */

function fakeStore(known: string[] = []) {
  const stored: Array<{ via: "dataUrl" | "blob"; assetId?: string; mimeType?: string; size?: number }> = [];
  let fresh = 0;
  const deps: AssetStoreDeps = {
    storeDataUrl: async (input) => {
      stored.push({ via: "dataUrl", assetId: input.assetId, mimeType: input.mimeType });
      return { assetId: input.assetId ?? `asset-local-fresh-${(fresh += 1)}`, mimeType: input.mimeType ?? "image/png" };
    },
    storeBlob: async (input) => {
      stored.push({ via: "blob", assetId: input.assetId, mimeType: input.mimeType, size: input.blob.size });
      return { assetId: input.assetId ?? `asset-local-fresh-${(fresh += 1)}`, mimeType: input.mimeType ?? input.blob.type };
    },
    resolveUrl: async (token) => (known.includes(token.replace(/^asset:/, "")) ? `blob:${token}` : null)
  };

  return { stored, deps };
}

const withSource = (source: GeneratedReviewImageAsset["source"], assetId = "asset-image-9", mimeType = "image/png"): GeneratedReviewImageAsset => ({ assetId, mimeType, source });

test("a data URL is stored once, under the id the server gave the image", async () => {
  const { stored, deps } = fakeStore();

  assert.deepEqual(await storeGeneratedAsset(dataAsset, deps), { assetId: "asset-image-1", mimeType: "image/png" });
  assert.deepEqual(stored, [{ via: "dataUrl", assetId: "asset-image-1", mimeType: "image/png" }]);

  // The legacy shape with a bare `dataUrl` field is read too; the type is taken from the data, not the label.
  const legacy = { assetId: "asset-image-0", mimeType: "image/png", dataUrl: "data:image/jpeg;base64,/9j/4AAQ" } as unknown as GeneratedReviewImageAsset;
  assert.deepEqual(await storeGeneratedAsset(legacy, deps), { assetId: "asset-image-0", mimeType: "image/jpeg" });
  assert.deepEqual(await storeGeneratedAsset(withSource({ kind: "data_url", dataUrl: "data:image/webp;base64,UklGRg==" }, "asset-image-w"), deps), {
    assetId: "asset-image-w",
    mimeType: "image/webp"
  });
});

test("an existing asset record is never overwritten: a taken id gets a fresh one", async () => {
  const { stored, deps } = fakeStore(["asset-image-1"]);
  const result = await storeGeneratedAsset(dataAsset, deps);

  assert.notEqual(result.assetId, "asset-image-1");
  assert.equal(result.assetId, "asset-local-fresh-1");
  assert.deepEqual(stored, [{ via: "dataUrl", assetId: undefined, mimeType: "image/png" }], "stored without an id, so the store makes a new record");

  // The same for a downloaded image.
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const remote = await storeGeneratedAsset(withSource({ kind: "remote_url", url: "https://images.example/1.png" }, "asset-image-1"), {
    ...deps,
    fetchImpl: async () => new Response(png, { status: 200 })
  });
  assert.equal(remote.assetId, "asset-local-fresh-2");
});

test("only PNG, JPEG and WebP are taken: SVG, HTML and unlabelled data are refused before the store", async () => {
  const { stored, deps } = fakeStore();
  const refused = [
    "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+",
    "data:text/html;base64,PGI+",
    "data:image/gif;base64,R0lGODlh",
    "data:;base64,AAAA",
    "data:application/octet-stream;base64,AAAA"
  ];

  for (const dataUrl of refused) {
    await assert.rejects(storeGeneratedAsset(withSource({ kind: "data_url", dataUrl }), deps), /unsupported image type/, dataUrl.slice(0, 30));
  }

  // The label on the asset does not rescue it: the data says what it is.
  await assert.rejects(storeGeneratedAsset(withSource({ kind: "data_url", dataUrl: refused[0]! }, "a", "image/png"), deps), /unsupported image type/);
  // Not base64: never decoded.
  await assert.rejects(storeGeneratedAsset(withSource({ kind: "data_url", dataUrl: "data:image/png,%89PNG" }), deps), /not base64/);
  await assert.rejects(storeGeneratedAsset(withSource({ kind: "data_url", dataUrl: "data:image/png;base64," }), deps), /empty/);
  assert.deepEqual(stored, []);
});

test("the size cap holds for data URLs and for downloads: the reviewer's 50 MB image is refused", async () => {
  const { stored, deps } = fakeStore();
  const fiftyMb = `data:image/png;base64,${"A".repeat(Math.ceil((50 * 1024 * 1024 * 4) / 3))}`;

  await assert.rejects(storeGeneratedAsset(withSource({ kind: "data_url", dataUrl: fiftyMb }), deps), /too large \(50 MB; the limit is 20 MB\)/);
  await assert.rejects(
    storeGeneratedAsset(withSource({ kind: "data_url", dataUrl: `data:image/svg+xml;base64,${"A".repeat(1024)}` }), deps),
    /unsupported image type/
  );

  // Just inside the limit is taken.
  const inside = `data:image/jpeg;base64,${"A".repeat(Math.floor((IMAGE_MAX_BYTES * 4) / 3) - 8)}`;
  assert.equal((await storeGeneratedAsset(withSource({ kind: "data_url", dataUrl: inside }, "asset-big"), deps)).assetId, "asset-big");

  // A download that declares too much is refused before its body is read; one that lies is caught after.
  let bodyRead = false;
  const declared = new Response(null, { status: 200, headers: { "content-length": String(IMAGE_MAX_BYTES + 1), "content-type": "image/png" } });
  Object.defineProperty(declared, "blob", {
    value: async () => {
      bodyRead = true;
      return new Blob([]);
    }
  });
  await assert.rejects(storeGeneratedAsset(withSource({ kind: "remote_url", url: "https://images.example/huge.png" }), { ...deps, fetchImpl: async () => declared }), /too large/);
  assert.equal(bodyRead, false);

  const lying = new Blob([new Uint8Array(IMAGE_MAX_BYTES + 1)], { type: "image/png" });
  await assert.rejects(
    storeGeneratedAsset(withSource({ kind: "remote_url", url: "https://images.example/lying.png" }), { ...deps, fetchImpl: async () => new Response(lying, { status: 200 }) }),
    /too large/
  );
  assert.equal(stored.length, 1, "only the image inside the limit reached the store");
});

test("a remote image is fetched over https only, without credentials, with a signal, and checked like any other", async () => {
  const remote = withSource({ kind: "remote_url", url: "https://images.example/9.png" });
  const fetched: Array<{ url: string; init?: RequestInit }> = [];
  const { stored, deps } = fakeStore();
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

  assert.deepEqual(
    await storeGeneratedAsset(remote, {
      ...deps,
      fetchImpl: async (url, init) => {
        fetched.push({ url, init });
        return new Response(png, { status: 200 });
      }
    }),
    { assetId: "asset-image-9", mimeType: "image/png" }
  );
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0]!.url, "https://images.example/9.png");
  assert.equal(fetched[0]!.init?.credentials, "omit");
  assert.equal(fetched[0]!.init?.method, "GET");
  assert.ok(fetched[0]!.init?.signal instanceof AbortSignal);
  assert.deepEqual(stored, [{ via: "blob", assetId: "asset-image-9", mimeType: "image/png", size: 4 }]);

  let called = 0;
  const never = async () => {
    called += 1;
    return new Response(png, { status: 200 });
  };

  for (const url of ["http://images.example/9.png", "javascript:alert(1)", "ftp://images.example/9.png", "//images.example/9.png", "blob:https://x/1"]) {
    await assert.rejects(storeGeneratedAsset(withSource({ kind: "remote_url", url }), { ...deps, fetchImpl: never }), /only https/, url);
  }

  assert.equal(called, 0, "nothing but https is ever requested");

  await assert.rejects(storeGeneratedAsset(remote, { ...deps, fetchImpl: async () => new Response("nope", { status: 403 }) }), /HTTP 403/);
  await assert.rejects(
    storeGeneratedAsset(remote, { ...deps, fetchImpl: async () => new Response(new Blob(["<svg/>"], { type: "image/svg+xml" }), { status: 200 }) }),
    /unsupported image type/
  );
  await assert.rejects(
    storeGeneratedAsset(remote, { ...deps, fetchImpl: async () => new Response(new Blob(["<html>"], { type: "text/html" }), { status: 200 }) }),
    /unsupported image type/
  );
  assert.equal(stored.length, 1, "a refused download stores nothing");
});

test("a download stops when the generation is cancelled or takes too long", async () => {
  const remote = withSource({ kind: "remote_url", url: "https://images.example/slow.png" });
  const { stored, deps } = fakeStore();
  const seen: { signal?: AbortSignal | null } = {};
  const controller = new AbortController();
  const pending = storeGeneratedAsset(remote, { ...deps, signal: controller.signal, fetchImpl: hanging(seen) });

  // The existence check runs first; the download starts on a later tick.
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(pending, /aborted/);
  assert.equal(seen.signal?.aborted, true);

  await assert.rejects(storeGeneratedAsset(remote, { ...deps, downloadTimeoutMs: 5, fetchImpl: hanging({}) }), /aborted/);
  assert.deepEqual(stored, []);
});

test("an asset token points at an image that is in the store already: checked, never copied", async () => {
  const { stored, deps } = fakeStore(["asset-local-7"]);
  const token = withSource({ kind: "asset_token", token: "asset:asset-local-7" }, "server-side-name", "image/webp");

  assert.deepEqual(await storeGeneratedAsset(token, deps), { assetId: "asset-local-7", mimeType: "image/webp" });
  assert.deepEqual(stored, [], "nothing is written again");

  await assert.rejects(storeGeneratedAsset(withSource({ kind: "asset_token", token: "asset:gone" }), deps), /gone/);
  await assert.rejects(storeGeneratedAsset(withSource({ kind: "data_url", dataUrl: "  " }), deps), /empty/);
});
