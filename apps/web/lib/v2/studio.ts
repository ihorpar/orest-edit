import type { ImageBlock } from "../editor/document-model.ts";
import type { EditorialVisualIntent, VisualImageQuality, VisualStylePreset } from "../editor/review-contract.ts";
import {
  DEFAULT_VISUAL_IMAGE_QUALITY,
  DEFAULT_VISUAL_STYLE_PRESET,
  normalizeVisualImageQuality,
  normalizeVisualStylePreset
} from "../editor/settings.ts";

/**
 * The illustration studio as a state machine. Everything the studio knows about one illustration lives on
 * its queue item (`item.studio`), so closing the studio loses nothing and a reload brings it back:
 *
 *   opened → prompt prepared → (prompt edited) → generating → generated
 *          → settings or prompt changed: the image is stale → regenerated → inserted (→ replaced)
 *
 * A pure module: no React, no network, no storage. Image bytes never come here; a generated image is known
 * only by the id it has in the browser's asset store.
 */

export interface V2StudioAsset {
  /** Id in the asset store (`orest-editor-assets-v1`). */
  assetId: string;
  mimeType: string;
  /** What the image was generated for: `getStudioSignature` of the prompt and settings at that moment. */
  signature: string;
  at: string;
}

export type V2StudioPromptState =
  | { status: "idle" }
  | { status: "preparing" }
  /** `message` is the server's own text. */
  | { status: "failed"; message: string };

export type V2StudioGeneration =
  | { status: "idle" }
  | {
      /** One request is waiting for its answer; the image comes back in that answer or not at all. */
      status: "generating";
      startedAt: string;
      /** Prompt and settings the request was sent with. */
      signature: string;
    }
  | { status: "failed"; message: string }
  /** Given up by the editor. */
  | { status: "cancelled" }
  /** The page was reloaded while the request was waiting: its answer is lost and nothing is sent again. */
  | { status: "interrupted" };

export interface V2StudioData {
  intent: EditorialVisualIntent;
  style: VisualStylePreset;
  quality: VisualImageQuality;
  prompt: string;
  alt: string;
  caption: string;
  /** Intent and style the prompt text was written for; null until a prompt has been prepared. */
  preparedFor: { intent: EditorialVisualIntent; style: VisualStylePreset } | null;
  promptState: V2StudioPromptState;
  /** The latest generated image; kept when the prompt or settings change, and then shown as stale. */
  asset: V2StudioAsset | null;
  generation: V2StudioGeneration;
}

export interface V2StudioDefaults {
  intent: EditorialVisualIntent;
  style: VisualStylePreset;
  quality: VisualImageQuality;
}

/** The style and speed the editor chose last; new illustrations start with them. */
export interface V2VisualPrefs {
  style?: VisualStylePreset;
  quality?: VisualImageQuality;
}

export type V2StudioField =
  | { prompt: string }
  | { caption: string }
  | { intent: EditorialVisualIntent }
  | { style: VisualStylePreset }
  | { quality: VisualImageQuality };

export type V2StudioEvent =
  | { type: "field"; change: V2StudioField }
  | { type: "prompt/requested" }
  | {
      type: "prompt/ready";
      prompt: string;
      alt: string;
      caption?: string;
      /** What the request asked for; the prompt was written for exactly this. */
      intent: EditorialVisualIntent;
      style: VisualStylePreset;
    }
  | { type: "prompt/failed"; message: string }
  | { type: "prompt/cancelled" }
  | { type: "generation/requested"; at: string }
  | { type: "generation/completed"; assetId: string; mimeType: string; at: string }
  | { type: "generation/failed"; message: string }
  | { type: "generation/cancelled" };

const INTENTS: EditorialVisualIntent[] = ["infographic", "illustration"];

export function normalizeVisualIntent(value: unknown, fallback: EditorialVisualIntent = "infographic"): EditorialVisualIntent {
  return INTENTS.includes(value as EditorialVisualIntent) ? (value as EditorialVisualIntent) : fallback;
}

export function resolveStudioDefaults(input: {
  intent?: EditorialVisualIntent;
  prefs?: V2VisualPrefs;
  /** The style the classic editor remembered (read-only), used until v2 has a choice of its own. */
  classicStyle?: string | null;
}): V2StudioDefaults {
  return {
    intent: normalizeVisualIntent(input.intent),
    style: input.prefs?.style ?? normalizeVisualStylePreset(input.classicStyle, DEFAULT_VISUAL_STYLE_PRESET),
    quality: input.prefs?.quality ?? DEFAULT_VISUAL_IMAGE_QUALITY
  };
}

export function createStudioData(defaults: V2StudioDefaults): V2StudioData {
  return {
    intent: defaults.intent,
    style: defaults.style,
    quality: defaults.quality,
    prompt: "",
    alt: "",
    caption: "",
    preparedFor: null,
    promptState: { status: "idle" },
    asset: null,
    generation: { status: "idle" }
  };
}

/** Identity of "this prompt with these settings". An image is current only for the signature it was made for. */
export function getStudioSignature(studio: Pick<V2StudioData, "prompt" | "intent" | "style" | "quality">): string {
  return JSON.stringify([studio.prompt.trim(), studio.intent, studio.style, studio.quality]);
}

export function isStudioGenerating(studio: V2StudioData): boolean {
  return studio.generation.status === "generating";
}

export function isStudioBusy(studio: V2StudioData): boolean {
  return isStudioGenerating(studio) || studio.promptState.status === "preparing";
}

/** The prompt was written for another intent or style than the one chosen now. */
export function isPromptMismatched(studio: V2StudioData): boolean {
  return studio.preparedFor !== null && (studio.preparedFor.intent !== studio.intent || studio.preparedFor.style !== studio.style);
}

/** There is an image, but not for the prompt and settings on screen. */
export function isStudioStale(studio: V2StudioData): boolean {
  return studio.asset !== null && studio.asset.signature !== getStudioSignature(studio);
}

export type V2StudioPreview = "empty" | "generating" | "image" | "stale";

export function getStudioPreview(studio: V2StudioData): V2StudioPreview {
  if (isStudioGenerating(studio)) {
    return "generating";
  }

  if (!studio.asset) {
    return "empty";
  }

  return isStudioStale(studio) ? "stale" : "image";
}

export function canPreparePrompt(studio: V2StudioData): boolean {
  return !isStudioBusy(studio);
}

export function canGenerate(studio: V2StudioData): boolean {
  return studio.prompt.trim().length > 0 && !isStudioBusy(studio);
}

/**
 * True when the image may go into the manuscript: it exists, it was generated for exactly the prompt and
 * settings on screen, nothing is in flight, and it is the image the studio is showing right now
 * (`shownAssetId` is the asset whose picture has actually loaded in the preview).
 */
export function canInsertImage(studio: V2StudioData, shownAssetId: string | null): boolean {
  return Boolean(studio.asset && !isStudioStale(studio) && !isStudioBusy(studio) && shownAssetId === studio.asset.assetId);
}

/**
 * True when the editor (or a paid call) has put something into this illustration that a new run must not
 * throw away: a prompt, a caption, a generated image, or a request in flight.
 */
export function isStudioTouched(studio: V2StudioData | undefined): boolean {
  return Boolean(studio && (studio.asset || isStudioBusy(studio) || studio.prompt.trim() || studio.caption.trim()));
}

/** One word for where the illustration is, for the card and for tests. */
export type V2StudioPhase =
  | "unprepared"
  | "preparing"
  | "prompt_failed"
  | "prepared"
  | "generating"
  | "generation_failed"
  | "generated"
  | "stale";

export function getStudioPhase(studio: V2StudioData | undefined): V2StudioPhase {
  if (!studio) {
    return "unprepared";
  }

  if (studio.promptState.status === "preparing") {
    return "preparing";
  }

  if (studio.generation.status === "generating") {
    return "generating";
  }

  if (studio.promptState.status === "failed") {
    return "prompt_failed";
  }

  if (studio.generation.status === "failed" || studio.generation.status === "interrupted") {
    return "generation_failed";
  }

  if (studio.asset) {
    return isStudioStale(studio) ? "stale" : "generated";
  }

  return studio.prompt.trim() ? "prepared" : "unprepared";
}

export function studioReducer(studio: V2StudioData, event: V2StudioEvent): V2StudioData {
  switch (event.type) {
    case "field": {
      const { change } = event;

      if ("caption" in change) {
        // The caption is not part of what the image is generated from; it can be typed at any time.
        return change.caption === studio.caption ? studio : { ...studio, caption: change.caption };
      }

      // The request in flight was made for the prompt and settings as they are; they do not move under it.
      if (isStudioBusy(studio)) {
        return studio;
      }

      if ("prompt" in change) {
        return change.prompt === studio.prompt ? studio : { ...studio, prompt: change.prompt };
      }

      if ("intent" in change) {
        return change.intent === studio.intent ? studio : { ...studio, intent: change.intent };
      }

      if ("style" in change) {
        return change.style === studio.style ? studio : { ...studio, style: change.style };
      }

      return change.quality === studio.quality ? studio : { ...studio, quality: change.quality };
    }

    case "prompt/requested":
      return canPreparePrompt(studio) ? { ...studio, promptState: { status: "preparing" } } : studio;

    case "prompt/ready": {
      if (studio.promptState.status !== "preparing" || !event.prompt.trim()) {
        return studio;
      }

      return {
        ...studio,
        prompt: event.prompt,
        alt: event.alt.trim() || studio.alt,
        // A caption the editor has typed is theirs; the model's own is taken only into an empty field.
        caption: studio.caption.trim() ? studio.caption : (event.caption ?? "").trim(),
        preparedFor: { intent: event.intent, style: event.style },
        promptState: { status: "idle" }
      };
    }

    case "prompt/failed":
      return studio.promptState.status === "preparing" ? { ...studio, promptState: { status: "failed", message: event.message } } : studio;

    case "prompt/cancelled":
      return studio.promptState.status === "preparing" ? { ...studio, promptState: { status: "idle" } } : studio;

    case "generation/requested":
      return canGenerate(studio)
        ? {
            ...studio,
            generation: { status: "generating", startedAt: event.at, signature: getStudioSignature(studio) }
          }
        : studio;

    case "generation/completed":
      return studio.generation.status === "generating" && event.assetId
        ? {
            ...studio,
            asset: { assetId: event.assetId, mimeType: event.mimeType, signature: studio.generation.signature, at: event.at },
            generation: { status: "idle" }
          }
        : studio;

    case "generation/failed":
      // The earlier image, if any, stays: it is still the image for whatever it was generated for.
      return studio.generation.status === "generating" ? { ...studio, generation: { status: "failed", message: event.message } } : studio;

    case "generation/cancelled":
      return studio.generation.status === "generating" ? { ...studio, generation: { status: "cancelled" } } : studio;
  }
}

/* ---------- the block an illustration becomes ---------- */

/** The image block `Вставити в текст` puts into the manuscript, as in the classic editor. */
export function buildFigureBlock(studio: V2StudioData, id: string, fallbackAlt: string): ImageBlock | null {
  if (!studio.asset || !id) {
    return null;
  }

  return {
    id,
    type: "image",
    assetId: studio.asset.assetId,
    alt: studio.alt.trim() || fallbackAlt.trim(),
    caption: [{ text: studio.caption.trim() }]
  };
}

/* ---------- persistence ---------- */

/**
 * The studio as it is written to the draft. Nothing in flight survives a reload: a prompt preparation is
 * simply not prepared, and a generation is recorded as interrupted, so a reload can never send it again.
 */
export function serializeStudioData(studio: V2StudioData): V2StudioData {
  const promptState: V2StudioPromptState = studio.promptState.status === "preparing" ? { status: "idle" } : studio.promptState;
  const generation: V2StudioGeneration = studio.generation.status === "generating" ? { status: "interrupted" } : studio.generation;

  return promptState === studio.promptState && generation === studio.generation ? studio : { ...studio, promptState, generation };
}

function coerceGeneration(value: unknown): V2StudioGeneration {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  switch (record.status) {
    case "generating":
      // Also what a draft written by an earlier build with resumable jobs holds: nothing is picked up again.
      return { status: "interrupted" };
    case "failed":
      return typeof record.message === "string" && record.message ? { status: "failed", message: record.message } : { status: "idle" };
    case "cancelled":
      return { status: "cancelled" };
    case "interrupted":
      return { status: "interrupted" };
    default:
      return { status: "idle" };
  }
}

/** Reads the studio part of a stored item; anything unreadable means the illustration starts over. */
export function coerceStudioData(value: unknown): V2StudioData | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.prompt !== "string") {
    return undefined;
  }

  const intent = normalizeVisualIntent(record.intent);
  const style = normalizeVisualStylePreset(record.style);
  const prepared = record.preparedFor && typeof record.preparedFor === "object" ? (record.preparedFor as Record<string, unknown>) : null;
  const asset = record.asset && typeof record.asset === "object" ? (record.asset as Record<string, unknown>) : null;
  const promptState = record.promptState && typeof record.promptState === "object" ? (record.promptState as Record<string, unknown>) : {};

  return {
    intent,
    style,
    quality: normalizeVisualImageQuality(record.quality),
    prompt: record.prompt,
    alt: typeof record.alt === "string" ? record.alt : "",
    caption: typeof record.caption === "string" ? record.caption : "",
    preparedFor: prepared ? { intent: normalizeVisualIntent(prepared.intent, intent), style: normalizeVisualStylePreset(prepared.style, style) } : null,
    promptState:
      promptState.status === "failed" && typeof promptState.message === "string" && promptState.message
        ? { status: "failed", message: promptState.message }
        : { status: "idle" },
    asset:
      asset && typeof asset.assetId === "string" && asset.assetId && typeof asset.signature === "string"
        ? {
            assetId: asset.assetId,
            mimeType: typeof asset.mimeType === "string" ? asset.mimeType : "",
            signature: asset.signature,
            at: typeof asset.at === "string" ? asset.at : ""
          }
        : null,
    generation: coerceGeneration(record.generation)
  };
}

export function coerceVisualPrefs(value: unknown): V2VisualPrefs {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  const style = typeof record.style === "string" ? normalizeVisualStylePreset(record.style, "" as VisualStylePreset) : "";
  const quality = typeof record.quality === "string" ? normalizeVisualImageQuality(record.quality, "" as VisualImageQuality) : "";

  return { ...(style ? { style } : {}), ...(quality ? { quality } : {}) };
}
