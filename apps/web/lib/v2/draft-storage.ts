import {
  createEmptyParagraphBlock,
  sanitizeEditorDocumentText,
  type EditorDocument
} from "../editor/document-model.ts";
import {
  getEditorDraftStorageKey,
  getLegacyEditorDraftStorageKeys,
  getLocaleStorageSuffix,
  type AppLocale
} from "../i18n/product-locale.ts";
import { coercePersistedReview, type V2PersistedReview } from "./store.ts";

/**
 * v2 keeps its draft in its own localStorage key. The v1 draft keys are only ever read (once, to seed an
 * empty v2 draft) and never written or removed from here.
 */

export interface V2DraftState {
  version: 1;
  document: EditorDocument;
  /** Name of the imported file the manuscript came from, if any. */
  sourceName: string | null;
  /**
   * Suggestion engine state (queue, prepared proposals, decisions, the run in flight). Absent in drafts
   * saved before the engine existed; such drafts open with an empty queue.
   */
  review?: V2PersistedReview;
  updatedAt: string;
}

export type V2DraftSource = "v2" | "v1" | "empty";

export type V2DraftInspection = { status: "absent" } | { status: "unreadable" } | { status: "ok"; draft: V2DraftState };

export type V2InitialDraft =
  | {
      status: "ready";
      draft: V2DraftState;
      source: V2DraftSource;
      /** True when the v2 key currently holds exactly this draft. */
      persisted: boolean;
      /** Set when the one-time copy of the v1 document could not be saved under the v2 key. */
      writeError?: unknown;
    }
  /** The v2 key holds something that cannot be read as a v2 draft. Nothing was copied or written. */
  | { status: "unreadable" };

export type V2DraftWriteResult = { status: "written"; updatedAt: string } | { status: "conflict" };

type DraftReader = Pick<Storage, "getItem">;
type DraftStorage = Pick<Storage, "getItem" | "setItem">;

export function getV2DraftStorageKey(locale: AppLocale): string {
  return `orest-v2-draft-${getLocaleStorageSuffix(locale)}-v1`;
}

export function createV2Draft(
  document: EditorDocument,
  sourceName: string | null = null,
  review?: V2PersistedReview | null
): V2DraftState {
  return {
    version: 1,
    document,
    sourceName,
    ...(review ? { review } : {}),
    updatedAt: new Date().toISOString()
  };
}

/** Tells a missing v2 draft apart from one that is there but cannot be read (corrupt JSON, unknown version). */
export function inspectV2Draft(storage: DraftReader, locale: AppLocale): V2DraftInspection {
  const raw = storage.getItem(getV2DraftStorageKey(locale));

  if (raw === null) {
    return { status: "absent" };
  }

  const parsed = parseJson(raw);

  if (!parsed || parsed.version !== 1 || !isEditorDocument(parsed.document)) {
    return { status: "unreadable" };
  }

  const review = coercePersistedReview(parsed.review);

  return {
    status: "ok",
    draft: {
      version: 1,
      document: sanitizeEditorDocumentText(parsed.document),
      sourceName: typeof parsed.sourceName === "string" && parsed.sourceName.trim() ? parsed.sourceName : null,
      ...(review ? { review } : {}),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString()
    }
  };
}

export function readV2Draft(storage: DraftReader, locale: AppLocale): V2DraftState | null {
  const inspection = inspectV2Draft(storage, locale);
  return inspection.status === "ok" ? inspection.draft : null;
}

/** Throws when the browser refuses the write (quota, private mode), so the caller can show the real error. */
export function writeV2Draft(storage: DraftStorage, locale: AppLocale, draft: V2DraftState): void {
  storage.setItem(getV2DraftStorageKey(locale), JSON.stringify(draft));
}

/**
 * True when the stored draft is not the one this tab last read or wrote (`lastKnownUpdatedAt`, null when
 * this tab has not seen a stored draft): another tab saved in between, or the key became unreadable.
 * A key that is simply gone is not a conflict, because writing it again overwrites nothing.
 */
export function hasV2DraftChangedElsewhere(storage: DraftReader, locale: AppLocale, lastKnownUpdatedAt: string | null): boolean {
  const inspection = inspectV2Draft(storage, locale);

  if (inspection.status === "absent") {
    return false;
  }

  return inspection.status === "unreadable" || inspection.draft.updatedAt !== lastKnownUpdatedAt;
}

/** Saves the draft unless another tab changed the stored one since this tab last read or wrote it. */
export function writeV2DraftIfUnchanged(
  storage: DraftStorage,
  locale: AppLocale,
  draft: V2DraftState,
  lastKnownUpdatedAt: string | null
): V2DraftWriteResult {
  if (hasV2DraftChangedElsewhere(storage, locale, lastKnownUpdatedAt)) {
    return { status: "conflict" };
  }

  // Two saves within one clock tick must still be told apart.
  const updatedAt =
    draft.updatedAt === lastKnownUpdatedAt ? new Date(new Date(draft.updatedAt).getTime() + 1).toISOString() : draft.updatedAt;

  writeV2Draft(storage, locale, { ...draft, updatedAt });
  return { status: "written", updatedAt };
}

/** Read-only look at the v1 draft: returns its document, or null when there is no usable v1 draft. */
export function readV1DraftDocument(storage: DraftReader, locale: AppLocale): EditorDocument | null {
  const keys = locale === "uk" ? [getEditorDraftStorageKey(locale), ...getLegacyEditorDraftStorageKeys()] : [getEditorDraftStorageKey(locale)];

  for (const key of keys) {
    const raw = storage.getItem(key);

    if (!raw) {
      continue;
    }

    const parsed = parseJson(raw);
    return parsed && isEditorDocument(parsed.document) ? sanitizeEditorDocumentText(parsed.document) : null;
  }

  return null;
}

/**
 * Loads the v2 draft. When there is none yet and a v1 draft exists, its document is copied into a new v2
 * draft and saved, so the copy happens exactly once. An unreadable v2 draft is reported as such and left
 * untouched: it is neither replaced by the v1 copy nor by an empty document.
 */
export function loadInitialV2Draft(storage: DraftStorage, locale: AppLocale): V2InitialDraft {
  const existing = inspectV2Draft(storage, locale);

  if (existing.status === "unreadable") {
    return { status: "unreadable" };
  }

  if (existing.status === "ok") {
    return { status: "ready", draft: existing.draft, source: "v2", persisted: true };
  }

  const v1Document = readV1DraftDocument(storage, locale);

  if (v1Document && v1Document.blocks.length > 0) {
    const draft = createV2Draft(structuredClone(v1Document));

    try {
      writeV2Draft(storage, locale, draft);
    } catch (error) {
      return { status: "ready", draft, source: "v1", persisted: false, writeError: error };
    }

    return { status: "ready", draft, source: "v1", persisted: true };
  }

  return {
    status: "ready",
    draft: createV2Draft({ version: 2, blocks: [createEmptyParagraphBlock()] }),
    source: "empty",
    persisted: false
  };
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isEditorDocument(value: unknown): value is EditorDocument {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<EditorDocument>;
  return candidate.version === 2 && Array.isArray(candidate.blocks);
}
