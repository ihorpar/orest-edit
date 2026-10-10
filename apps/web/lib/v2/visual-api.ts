import { parseEditorAssetToken } from "../editor/asset-store.ts";
import type { EditorDocument } from "../editor/document-model.ts";
import {
  resolveReviewImageAssetUrl,
  type EditorialReviewItem,
  type EditorialVisualIntent,
  type GeneratedReviewImageAsset,
  type ReviewActionRequest,
  type VisualImageQuality,
  type VisualStylePreset
} from "../editor/review-contract.ts";
import { normalizeVisualImageQuality, normalizeVisualStylePreset, type EditorSettings } from "../editor/settings.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import { buildProposalRequest, interpretProposalReply, REVIEW_PROPOSAL_ENDPOINT, type ReviewApiMessages } from "./api.ts";
import { normalizeVisualIntent } from "./studio.ts";

/**
 * Client for the two calls behind an illustration, as the classic editor makes them:
 *
 * - `POST /api/edit/review/proposal` for a `visual` item returns an `image_prompt` proposal (the prompt, the
 *   alt text and a caption);
 * - `POST /api/edit/review/image` generates the image and returns it in the same response.
 *
 * Every failure carries a message a person can read, the server's own when there is one. Nothing here
 * invents a prompt or an image.
 */

export const REVIEW_IMAGE_ENDPOINT = "/api/edit/review/image";
/** How long the client waits for the image: a little above the route's own limit of 60 seconds. */
export const IMAGE_REQUEST_TIMEOUT_MS = 75_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface VisualApiMessages extends Pick<ReviewApiMessages, "network"> {
  /** The proposal reply could not be read as an image prompt. */
  promptInvalid: string;
  /** The model answered with nothing; the server's stand-in text is not shown as a prompt. */
  promptEmpty: string;
  /** The image reply could not be read. */
  imageInvalid: string;
  /** The server answered without an image and without a reason. */
  imageEmpty: string;
  /** The image did not arrive in time. */
  imageTimeout: string;
  /** The generated image could not be put into the browser's asset store. */
  assetFailed: string;
}

function describeNetworkError(error: unknown, messages: Pick<VisualApiMessages, "network">): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  return detail ? `${messages.network} ${detail}` : messages.network;
}

function withHttpStatus(message: string, httpStatus: number): string {
  return httpStatus >= 400 ? `${message} (HTTP ${httpStatus})` : message;
}

/* ---------- the image prompt ---------- */

export interface VisualProposalRequestInput {
  document: EditorDocument;
  item: EditorialReviewItem;
  settings: EditorSettings;
  locale: AppLocale;
  intent: EditorialVisualIntent;
  style: VisualStylePreset;
  quality: VisualImageQuality;
}

/**
 * The proposal request of the classic editor for a `prepare_visual` item: the compact item with the chosen
 * intent, the image prompt template from settings, and the chosen style and speed.
 */
export function buildVisualProposalRequest(input: VisualProposalRequestInput): ReviewActionRequest {
  const item: EditorialReviewItem = {
    ...input.item,
    recommendationType: "visual",
    suggestedAction: "prepare_visual",
    visualIntent: input.intent
  };

  return {
    ...buildProposalRequest({ document: input.document, item, settings: input.settings, locale: input.locale }),
    imagePromptTemplate: input.settings.imagePromptTemplate,
    visualStylePreset: input.style,
    imageQuality: input.quality
  };
}

export type VisualPromptReply =
  | {
      kind: "prompt";
      prompt: string;
      alt: string;
      caption: string;
      intent: EditorialVisualIntent;
      style: VisualStylePreset;
      quality: VisualImageQuality;
    }
  | { kind: "stale_anchor"; message: string }
  | { kind: "error"; message: string; httpStatus?: number };

export function interpretVisualPromptReply(
  responseText: string,
  httpStatus: number,
  messages: VisualApiMessages,
  requested: { intent: EditorialVisualIntent; style: VisualStylePreset; quality: VisualImageQuality }
): VisualPromptReply {
  const reply = interpretProposalReply(responseText, httpStatus, { ...EMPTY_REVIEW_MESSAGES, ...messages, proposalInvalid: messages.promptInvalid });

  if (reply.kind === "error") {
    return reply;
  }

  if (reply.kind === "stale_anchor") {
    return { kind: "stale_anchor", message: reply.message };
  }

  const draft = reply.kind === "draft" && reply.proposal.kind === "image_prompt" ? reply.proposal.imageDraft : undefined;

  if (!draft || typeof draft.prompt !== "string" || !draft.prompt.trim()) {
    return { kind: "error", message: messages.promptInvalid, httpStatus };
  }

  // When the model answers with nothing, the server fills the prompt with a text of its own. That is not
  // the model's prompt, so it is reported as the empty answer it was.
  let rawOutput: unknown;

  try {
    rawOutput = (JSON.parse(responseText) as { diagnostics?: { rawOutput?: unknown } }).diagnostics?.rawOutput;
  } catch {
    rawOutput = undefined;
  }

  if (typeof rawOutput === "string" && !rawOutput.trim()) {
    return { kind: "error", message: messages.promptEmpty, httpStatus };
  }

  return {
    kind: "prompt",
    prompt: draft.prompt.trim(),
    alt: typeof draft.alt === "string" ? draft.alt.trim() : "",
    caption: typeof draft.caption === "string" ? draft.caption.trim() : "",
    intent: normalizeVisualIntent(draft.visualIntent, requested.intent),
    style: normalizeVisualStylePreset(draft.visualStylePreset, requested.style),
    quality: normalizeVisualImageQuality(draft.imageQuality, requested.quality)
  };
}

const EMPTY_REVIEW_MESSAGES: ReviewApiMessages = {
  invalid: "",
  platformTimeout: "",
  pollTimeout: "",
  wrongLocale: "",
  resultInvalid: "",
  proposalInvalid: "",
  network: ""
};

export async function requestVisualPrompt(
  request: ReviewActionRequest,
  deps: { messages: VisualApiMessages; fetchImpl?: FetchLike; signal?: AbortSignal }
): Promise<VisualPromptReply> {
  const doFetch = deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  let response: Response;
  let text: string;

  try {
    response = await doFetch(REVIEW_PROPOSAL_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      signal: deps.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    text = await response.text();
  } catch (error) {
    return { kind: "error", message: describeNetworkError(error, deps.messages) };
  }

  return interpretVisualPromptReply(text, response.status, deps.messages, {
    intent: normalizeVisualIntent(request.item.visualIntent),
    style: normalizeVisualStylePreset(request.visualStylePreset),
    quality: normalizeVisualImageQuality(request.imageQuality)
  });
}

/* ---------- generating the image ---------- */

export interface ImageRequestBody {
  locale: AppLocale;
  prompt: string;
  imageQuality: VisualImageQuality;
}

/** Exactly the body the classic editor posts (`generateActiveReviewImage` in `app/editor/page.tsx`). */
export function buildImageRequest(input: { prompt: string; quality: VisualImageQuality; locale: AppLocale }): ImageRequestBody {
  return { locale: input.locale, prompt: input.prompt.trim(), imageQuality: input.quality };
}

export type ImageReply =
  | { kind: "image"; asset: GeneratedReviewImageAsset }
  | { kind: "failed"; message: string; httpStatus?: number }
  /** The editor stopped waiting. The request had been sent; the provider may still have been charged. */
  | { kind: "aborted" };

function readAsset(value: unknown): GeneratedReviewImageAsset | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const asset = value as GeneratedReviewImageAsset;
  return typeof asset.assetId === "string" && asset.assetId.trim() && resolveReviewImageAssetUrl(asset) ? asset : null;
}

/**
 * Reads the answer of the image endpoint. An error text from the server is the failure, whatever else the
 * answer carries; an image is the result; anything else is a failure with a plain reason. A queued job is
 * not a result: this client never asks for one, because the server keeps jobs in the memory of one instance.
 */
export function interpretImageReply(responseText: string, httpStatus: number, messages: VisualApiMessages): ImageReply {
  let payload: Record<string, unknown> | null;

  try {
    const parsed = JSON.parse(responseText) as unknown;
    payload = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }

  if (!payload) {
    return { kind: "failed", message: withHttpStatus(messages.imageInvalid, httpStatus), httpStatus };
  }

  const serverError = typeof payload.error === "string" && payload.error.trim() ? payload.error.trim() : null;

  if (serverError) {
    return { kind: "failed", message: serverError, httpStatus };
  }

  const ok = httpStatus >= 200 && httpStatus < 300;
  const asset = readAsset(payload.asset);

  if (asset && ok) {
    return { kind: "image", asset };
  }

  return { kind: "failed", message: withHttpStatus(ok ? messages.imageEmpty : messages.imageInvalid, httpStatus), httpStatus };
}

export interface GenerateImageDeps {
  messages: VisualApiMessages;
  fetchImpl?: FetchLike;
  /** Aborted when the editor cancels. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Timer functions, injected in tests. */
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/**
 * One request, one answer: the image comes back in the response, as in the classic editor. The wait is
 * bounded on the client a little above the route's own limit; running out of time is reported as such.
 */
export async function generateImage(body: ImageRequestBody, deps: GenerateImageDeps): Promise<ImageReply> {
  const doFetch = deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const setTimer = deps.setTimer ?? ((handler: () => void, ms: number) => setTimeout(handler, ms));
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();

  if (deps.signal?.aborted) {
    return { kind: "aborted" };
  }

  deps.signal?.addEventListener("abort", cancel);
  const timer = setTimer(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? IMAGE_REQUEST_TIMEOUT_MS);

  try {
    const response = await doFetch(REVIEW_IMAGE_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    return interpretImageReply(await response.text(), response.status, deps.messages);
  } catch (error) {
    if (timedOut) {
      return { kind: "failed", message: deps.messages.imageTimeout };
    }

    if (deps.signal?.aborted) {
      return { kind: "aborted" };
    }

    return { kind: "failed", message: describeNetworkError(error, deps.messages) };
  } finally {
    clearTimer(timer);
    deps.signal?.removeEventListener("abort", cancel);
  }
}

/* ---------- the generated image → the asset store ---------- */

/** What a generated image may be. Anything else (SVG, HTML, unknown) is refused. */
export const IMAGE_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];
/** Largest image taken into the browser's store, in decoded bytes. The models return 1–3 MB. */
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface AssetStoreDeps {
  /** Without `assetId` the store gives the image a fresh id. */
  storeDataUrl: (input: { dataUrl: string; assetId?: string; mimeType?: string }) => Promise<{ assetId: string; mimeType: string }>;
  storeBlob: (input: { blob: Blob; assetId?: string; mimeType?: string }) => Promise<{ assetId: string; mimeType: string }>;
  /** Resolves an `asset:` token to a displayable URL, or null when the store has no such asset. */
  resolveUrl: (token: string) => Promise<string | null>;
  fetchImpl?: FetchLike;
  /** Aborted when the editor cancels the generation. */
  signal?: AbortSignal;
  downloadTimeoutMs?: number;
}

function normalizeMime(value: string | undefined | null): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

function assertImageType(mimeType: string) {
  if (!IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new Error(`unsupported image type ${mimeType || "(none)"}; only PNG, JPEG and WebP are taken`);
  }
}

function assertImageSize(bytes: number) {
  if (bytes <= 0) {
    throw new Error("the image is empty");
  }

  if (bytes > IMAGE_MAX_BYTES) {
    throw new Error(`the image is too large (${Math.round(bytes / (1024 * 1024))} MB; the limit is ${IMAGE_MAX_BYTES / (1024 * 1024)} MB)`);
  }
}

/**
 * Puts a generated image into the browser's asset store and returns the id it has there.
 *
 * - a data URL must be base64 PNG, JPEG or WebP within the size limit;
 * - a remote URL must be `https:`; it is downloaded without credentials, within a time limit, and checked
 *   the same way;
 * - an `asset:` token names an image that is in the store already (checked, not copied).
 *
 * An existing record is never overwritten: when the id from the response is taken, the image gets a fresh
 * one. Throws with a readable reason when the image cannot be stored: an illustration that cannot be shown
 * is never offered for insertion.
 */
export async function storeGeneratedAsset(asset: GeneratedReviewImageAsset, deps: AssetStoreDeps): Promise<{ assetId: string; mimeType: string }> {
  const source = resolveReviewImageAssetUrl(asset);

  if (!source) {
    throw new Error("empty image source");
  }

  const tokenAssetId = parseEditorAssetToken(source);

  if (tokenAssetId) {
    if (!(await deps.resolveUrl(source))) {
      throw new Error(`asset ${tokenAssetId} is not in the browser store`);
    }

    return { assetId: tokenAssetId, mimeType: asset.mimeType };
  }

  // Free unless the store already has a record under this id (an imported image, an earlier generation).
  const requestedId = typeof asset.assetId === "string" ? asset.assetId.trim() : "";
  const assetId = requestedId && !(await deps.resolveUrl(`asset:${requestedId}`)) ? requestedId : undefined;

  if (source.startsWith("data:")) {
    const match = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(source);
    const mimeType = normalizeMime(match?.[1]);

    if (!match || !/;base64$/i.test(match[2] ?? "")) {
      throw new Error("the image data is not base64");
    }

    assertImageType(mimeType);
    assertImageSize(Math.floor(((source.length - match[0].length) * 3) / 4));

    const stored = await deps.storeDataUrl({ dataUrl: source, ...(assetId ? { assetId } : {}), mimeType });
    return { assetId: stored.assetId, mimeType: stored.mimeType };
  }

  if (!/^https:\/\//i.test(source)) {
    throw new Error("unsupported image source: only https links are downloaded");
  }

  const doFetch = deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  deps.signal?.addEventListener("abort", cancel);
  const timer = setTimeout(cancel, deps.downloadTimeoutMs ?? IMAGE_DOWNLOAD_TIMEOUT_MS);
  let blob: Blob;

  try {
    if (deps.signal?.aborted) {
      throw new Error("cancelled");
    }

    const response = await doFetch(source, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const declared = Number(response.headers.get("content-length") ?? "");

    if (Number.isFinite(declared) && declared > 0) {
      assertImageSize(declared);
    }

    blob = await response.blob();
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", cancel);
  }

  const mimeType = normalizeMime(blob.type);
  assertImageType(mimeType);
  assertImageSize(blob.size);

  const stored = await deps.storeBlob({ blob, ...(assetId ? { assetId } : {}), mimeType });
  return { assetId: stored.assetId, mimeType: stored.mimeType };
}
