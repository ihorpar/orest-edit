"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createEditorAssetToken, resolveEditorAssetUrl } from "../../lib/editor/asset-store";
import type { EditorialVisualIntent } from "../../lib/editor/review-contract";
import { getVisualImageQualityOptions, getVisualStylePresetOptions } from "../../lib/editor/settings";
import type { AppLocale } from "../../lib/i18n/product-locale";
import type { V2Copy } from "../../lib/v2/copy";
import type { V2ReviewItem } from "../../lib/v2/item-kinds";
import { getFigureBlockId } from "../../lib/v2/store";
import {
  canGenerate,
  canInsertImage,
  canPreparePrompt,
  getStudioPreview,
  isPromptMismatched,
  isStudioBusy,
  type V2StudioData
} from "../../lib/v2/studio";
import { V2Icon } from "./icons";
import type { ReviewEngine, StudioTarget } from "./useReviewEngine";
import styles from "./v2.module.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const INTENTS: EditorialVisualIntent[] = ["infographic", "illustration"];
/** How long a studio text field waits after the last key before it hands its text to the suggestion store. */
const FIELD_COMMIT_DELAY_MS = 200;

/**
 * A text field that is typed in locally and handed to the store a moment after the last key, at once on
 * `flush` (blur, any action of the studio) and when the field goes away. Typing then costs one small render
 * instead of a pass through the whole suggestion state on every key. When the store changes the text itself
 * (a prepared prompt), that text replaces what is in the field.
 */
function useBufferedText(stored: string, commit: (text: string) => void) {
  const [local, setLocal] = useState(stored);
  const localRef = useRef(stored);
  // The text the store is known to have: what it gave us, or what we last sent it.
  const knownRef = useRef(stored);
  const timerRef = useRef<number | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const cancel = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const flush = useCallback(() => {
    cancel();

    if (localRef.current !== knownRef.current) {
      knownRef.current = localRef.current;
      commitRef.current(localRef.current);
    }
  }, []);

  const change = useCallback(
    (text: string) => {
      localRef.current = text;
      setLocal(text);
      cancel();
      timerRef.current = window.setTimeout(flush, FIELD_COMMIT_DELAY_MS);
    },
    [flush]
  );

  useEffect(() => {
    if (stored !== knownRef.current) {
      cancel();
      knownRef.current = stored;
      localRef.current = stored;
      setLocal(stored);
    }
  }, [stored]);

  // Nothing typed is lost when the studio closes.
  useEffect(() => flush, [flush]);

  return { value: local, change, flush };
}

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex="0"]';

interface VisualStudioProps {
  copy: V2Copy;
  locale: AppLocale;
  review: ReviewEngine;
  target: StudioTarget;
  /** AI actions are off (the draft cannot be saved): the studio can be read, nothing in it can be sent. */
  disabled: boolean;
}

/**
 * Where an asset's picture is: being read from the store, read (`url`), not in the store (`missing`).
 * Whether the browser could actually draw it is known only to the `<img>` that shows it.
 */
type AssetImage = { assetId: string; url: string | null; state: "loading" | "resolved" | "missing" };

/** The picture of an asset from the browser's store; `reload` reads it from the store again. */
function useAssetImage(assetId: string | null): { image: AssetImage | null; reload: () => void } {
  const [image, setImage] = useState<AssetImage | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!assetId) {
      setImage(null);
      return;
    }

    let alive = true;
    setImage({ assetId, url: null, state: "loading" });

    resolveEditorAssetUrl(createEditorAssetToken(assetId)).then(
      (url) => {
        if (alive) {
          setImage(url ? { assetId, url, state: "resolved" } : { assetId, url: null, state: "missing" });
        }
      },
      () => {
        if (alive) {
          setImage({ assetId, url: null, state: "missing" });
        }
      }
    );

    return () => {
      alive = false;
    };
  }, [assetId, attempt]);

  return { image: image && image.assetId === assetId ? image : null, reload: () => setAttempt((current) => current + 1) };
}

/**
 * The illustration studio: a roomy overlay with the image on the left and, on the right, everything it is
 * made from. It is a view of the illustration's own state (`item.studio`), so closing it loses nothing.
 * The image shown is always the real generated one; before there is one, the preview says so.
 *
 * It is a modal: while it is open the page behind it is inert, keys and focus stay in the dialog whatever
 * its own controls do (several of them disappear or go disabled when pressed), and Esc always closes it.
 */
export function VisualStudio({ copy, locale, review, target, disabled }: VisualStudioProps) {
  const text = copy.studio;
  const boxRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { closeStudio, findFigureBlockId } = review;
  const targetKey = target.kind === "item" ? `item:${target.itemId}` : `block:${target.blockId}`;

  useEffect(() => {
    const overlay = overlayRef.current;
    const box = boxRef.current;

    if (!overlay || !box) {
      return;
    }

    const page = window.document;
    const opener = page.activeElement;

    // Everything of the workspace behind the dialog is out of reach: no focus, no clicks, no typing.
    const behind = Array.from(overlay.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== overlay && !element.hasAttribute("data-studio-outside")
    );
    const restore = behind.map((element) => ({ element, inert: element.inert, hidden: element.getAttribute("aria-hidden") }));

    for (const element of behind) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    const bodyOverflow = page.body.style.overflow;
    page.body.style.overflow = "hidden";
    box.focus();

    // The message at the bottom of the page (and its buttons: `Повернути`, `Закрити`) is part of the dialog's
    // keyboard round, after its own controls: it is on screen above the studio and must be reachable.
    const toastButtons = () => Array.from(page.querySelectorAll<HTMLElement>("[data-v2-toast] button"));
    const focusables = () => [...Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)), ...toastButtons()];
    const inScope = (node: unknown) => node instanceof Node && (box.contains(node) || (node instanceof Element && node.closest("[data-v2-toast]") !== null));

    // Capture phase on the document: the keys are seen here wherever focus happens to be.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeStudio();
        return;
      }

      const inside = inScope(event.target);

      if (event.key === "Tab") {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        const active = page.activeElement;

        if (!first || !last) {
          event.preventDefault();
          box.focus();
        } else if (!inside || !inScope(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && (active === first || active === box)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }

        return;
      }

      if (!inside) {
        // A key pressed while focus was nowhere in the dialog belongs to nobody: it must not reach the
        // page's shortcuts or the manuscript. Focus is brought back for the next one. (Its default action
        // is left alone: the page behind is inert, and browser shortcuts such as reload must keep working.)
        event.stopPropagation();
        box.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!inScope(event.target)) {
        box.focus();
      }
    };

    page.addEventListener("keydown", handleKeyDown, true);
    page.addEventListener("focusin", handleFocusIn, true);

    return () => {
      page.removeEventListener("keydown", handleKeyDown, true);
      page.removeEventListener("focusin", handleFocusIn, true);
      page.body.style.overflow = bodyOverflow;

      for (const { element, inert, hidden } of restore) {
        element.inert = inert;

        if (hidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", hidden);
        }
      }

      // Focus goes back to what opened the studio. When that is gone (the card after an insert or a
      // rejection), it goes to the figure that was just inserted, else to the panel. Done once the page has
      // settled: the card and the figure change in the same update that closes the studio.
      const [kind, id] = targetKey.split(/:(.*)/s) as [string, string];
      const escaped = CSS.escape(id);

      // A timer, not an animation frame: frames do not run while the window is not being drawn.
      window.setTimeout(() => {
        if (page.querySelector("[data-studio]")) {
          // Another studio is open already (the next illustration): focus is its business.
          return;
        }

        const figureBlockId = kind === "item" ? findFigureBlockId(id) : id;
        const candidates: Array<Element | null> = [
          opener instanceof HTMLElement && opener.isConnected && opener !== page.body ? opener : null,
          kind === "item" ? page.querySelector(`[data-card="${escaped}"] [data-studio-open]`) : null,
          kind === "item" ? page.querySelector(`[data-sg-studio="${escaped}"]`) : null,
          figureBlockId ? page.querySelector(`[data-figure-edit="${CSS.escape(figureBlockId)}"]`) : null,
          page.querySelector('[role="tab"][aria-selected="true"]')
        ];
        const next = candidates.find((element): element is HTMLElement => element instanceof HTMLElement && !element.matches(":disabled"));

        if (next) {
          if (next.hasAttribute("data-figure-edit")) {
            next.scrollIntoView({ block: "center" });
          }

          next.focus();
        }
      }, 0);
    };
  }, [closeStudio, findFigureBlockId, targetKey]);

  // After every render: a control that was focused may have unmounted or gone disabled (`Згенерувати`
  // while it generates, `Скасувати` once it is pressed). Focus then returns to the dialog itself.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const active = window.document.activeElement;

    const inToast = active instanceof Element && active.closest("[data-v2-toast]") !== null;

    if (box && !inToast && (!active || !box.contains(active) || (active instanceof HTMLElement && active.matches(":disabled")))) {
      box.focus();
    }
  });

  const item = target.kind === "item" ? review.state.items.find((entry) => entry.id === target.itemId) : undefined;
  let title = "";
  let lead = "";
  let body: ReactNode = null;

  if (target.kind === "item" && item?.studio) {
    title = item.title;
    lead = item.reason.trim() || item.recommendation.trim();
    body = <ItemStudio copy={copy} locale={locale} review={review} item={item} studio={item.studio} disabled={disabled} />;
  } else if (target.kind === "block") {
    lead = text.manualLead;
    body = <FigureCaptionStudio copy={copy} review={review} blockId={target.blockId} disabled={disabled} />;
  }

  return (
    <div
      className={styles.studio}
      ref={overlayRef}
      data-studio={targetKey}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeStudio();
        }
      }}
    >
      <div className={styles.stBox} ref={boxRef} role="dialog" aria-modal="true" aria-label={text.label} tabIndex={-1}>
        <header>
          <div>
            <span className={cx(styles.ttag, styles.tVisual)}>
              <V2Icon name="visual" />
              {text.tag}
            </span>
            {title ? <b>{title}</b> : null}
            {lead ? <p>{lead}</p> : null}
          </div>
          <button type="button" className={styles.tb} title={text.close} aria-label={text.close} data-studio-close onClick={closeStudio}>
            <V2Icon name="x" />
          </button>
        </header>
        {body}
      </div>
    </div>
  );
}

function ItemStudio({
  copy,
  locale,
  review,
  item,
  studio: stored,
  disabled
}: {
  copy: V2Copy;
  locale: AppLocale;
  review: ReviewEngine;
  item: V2ReviewItem;
  studio: V2StudioData;
  disabled: boolean;
}) {
  const text = copy.studio;
  const itemId = item.id;
  const { setStudioField } = review;
  const promptField = useBufferedText(
    stored.prompt,
    useCallback((prompt: string) => setStudioField(itemId, { prompt }), [itemId, setStudioField])
  );
  const captionField = useBufferedText(
    stored.caption,
    useCallback((caption: string) => setStudioField(itemId, { caption }), [itemId, setStudioField])
  );
  // What the studio shows and judges by is the text as typed, also in the moment before the store has it.
  const studio = useMemo<V2StudioData>(
    () => (stored.prompt === promptField.value && stored.caption === captionField.value ? stored : { ...stored, prompt: promptField.value, caption: captionField.value }),
    [captionField.value, promptField.value, stored]
  );
  /** Every action of the studio works with the text as typed. */
  const flushFields = () => {
    promptField.flush();
    captionField.flush();
  };
  const preview = getStudioPreview(studio);
  const busy = isStudioBusy(studio);
  const generating = studio.generation.status === "generating" ? studio.generation : null;
  const preparing = studio.promptState.status === "preparing";
  const assetId = studio.asset?.assetId ?? null;
  const { image, reload } = useAssetImage(assetId);
  // Which asset the browser has actually drawn, and which one it could not draw.
  const [drawn, setDrawn] = useState<{ assetId: string; ok: boolean } | null>(null);
  const shownAssetId = image?.state === "resolved" && drawn?.ok && drawn.assetId === assetId ? assetId : null;
  const broken = image?.state === "resolved" && drawn !== null && !drawn.ok && drawn.assetId === assetId;
  const figureBlockId = getFigureBlockId(review.state, itemId);
  const figure = figureBlockId ? review.readFigure(figureBlockId) : null;
  const inText = Boolean(figureBlockId && figure);
  const insertable = canInsertImage(studio, shownAssetId);
  const stale = preview === "stale";
  const mismatch = isPromptMismatched(studio);
  const styleOptions = getVisualStylePresetOptions(locale);
  const qualityOptions = getVisualImageQualityOptions(locale);
  const qualityHint = qualityOptions.find((option) => option.value === studio.quality)?.hint ?? "";
  const lockSettings = disabled || busy;
  const elapsed = useElapsedSeconds(generating?.startedAt ?? null);
  const captionChanged = inText && figure !== null && studio.caption.trim() !== figure.caption.trim();
  const sameImage = inText && figure !== null && studio.asset !== null && figure.assetId === studio.asset.assetId;
  const gone = !inText && item.status === "stale";

  // Why the image cannot go into the text right now; shown under the buttons, never left to guessing.
  let blocker: string | null = null;

  if (disabled) {
    blocker = copy.edits.writeBlocked;
  } else if (gone) {
    blocker = copy.edits.visualGone;
  } else if (generating) {
    blocker = text.whyGenerating;
  } else if (preparing) {
    blocker = text.whyPreparing;
  } else if (!studio.asset) {
    blocker = text.insertNeedsImage;
  } else if (stale) {
    blocker = text.insertNeedsFresh;
  } else if (image?.state === "missing") {
    blocker = text.previewMissing;
  } else if (broken) {
    blocker = text.whyBroken;
  } else if (!shownAssetId) {
    blocker = text.whyLoading;
  } else if (sameImage) {
    blocker = text.replaceSame;
  }

  const canPlace = insertable && !gone && !sameImage && !disabled;

  let view: ReactNode;

  if (generating) {
    view = (
      <div className={cx(styles.ph, styles.phBusy)} role="status" data-studio-preview="generating">
        <span className={styles.spin} />
        <b>{text.generatingImage}</b>
        {/* Not read out every second: the counter is for the eye only. */}
        <span aria-hidden="true">{text.elapsed(elapsed)}</span>
        <button type="button" className={cx(styles.btn, styles.btnOutline, styles.btnSm)} data-studio-cancel onClick={() => review.cancelVisualGeneration(itemId)}>
          {text.cancel}
        </button>
      </div>
    );
  } else if (!studio.asset) {
    view = (
      <div className={styles.ph} data-studio-preview="empty">
        <b>{text.previewEmpty}</b>
      </div>
    );
  } else if (!image || image.state === "loading") {
    view = (
      <div className={styles.ph} role="status" data-studio-preview="loading">
        <span>{text.previewLoading}</span>
      </div>
    );
  } else if (image.state === "missing" || broken) {
    view = (
      <div className={styles.ph} role="alert" data-studio-preview={broken ? "broken" : "missing"}>
        <b>{broken ? text.previewBroken : text.previewMissing}</b>
        {broken ? <span>{text.previewBrokenHint}</span> : null}
        <button
          type="button"
          className={cx(styles.btn, styles.btnOutline, styles.btnSm)}
          data-studio-reload
          onClick={() => {
            setDrawn(null);
            reload();
          }}
        >
          {text.previewRetry}
        </button>
      </div>
    );
  } else {
    view = (
      <div className={cx(styles.shot, stale && styles.shotStale)} data-studio-preview={stale ? "stale" : "image"}>
        <img
          key={`${image.assetId}:${image.url}`}
          src={image.url ?? undefined}
          alt={studio.alt || item.title}
          draggable={false}
          onLoad={() => setDrawn({ assetId: image.assetId, ok: true })}
          onError={() => setDrawn({ assetId: image.assetId, ok: false })}
        />
        {stale ? <span className={styles.shotFlag}>{text.previewStale}</span> : null}
      </div>
    );
  }

  return (
    <div className={styles.vz} data-studio-phase={preview}>
      <div className={styles.vzView}>
        {view}
        {studio.caption.trim() ? <p className={styles.vzCap}>{studio.caption}</p> : null}
        {studio.generation.status === "failed" ? (
          <p className={styles.cardError} role="alert">
            <b>{text.generationFailed}</b> {studio.generation.message}
          </p>
        ) : null}
        {studio.generation.status === "interrupted" ? (
          <p className={styles.cardError} role="alert">
            {text.interrupted}
          </p>
        ) : null}
        {studio.generation.status === "cancelled" ? (
          <p className={styles.cardNote} role="status">
            {text.cancelled}
          </p>
        ) : null}
      </div>
      <div className={styles.vzForm}>
        <div className={styles.vzRow}>
          <span className={styles.vzSeg} role="group" aria-label={text.intent}>
            {INTENTS.map((intent) => (
              <button
                key={intent}
                type="button"
                className={studio.intent === intent ? styles.vzSegOn : undefined}
                aria-pressed={studio.intent === intent}
                disabled={lockSettings}
                onClick={() => {
                flushFields();
                review.setStudioField(itemId, { intent });
              }}
              >
                {text.intents[intent]}
              </button>
            ))}
          </span>
          <span className={styles.vzSeg} role="group" aria-label={text.quality}>
            {qualityOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={studio.quality === option.value ? styles.vzSegOn : undefined}
                aria-pressed={studio.quality === option.value}
                title={option.hint}
                disabled={lockSettings}
                onClick={() => {
                flushFields();
                review.setStudioField(itemId, { quality: option.value });
              }}
              >
                {option.label}
              </button>
            ))}
          </span>
          {qualityHint ? <span className={styles.vzHint}>{qualityHint}</span> : null}
        </div>
        <label className={styles.vzField}>
          {text.prompt}
          <textarea
            rows={9}
            value={studio.prompt}
            placeholder={preparing ? text.promptPreparing : text.promptPlaceholder}
            readOnly={busy}
            disabled={disabled}
            data-studio-prompt
            onChange={(event) => promptField.change(event.target.value)}
            onBlur={promptField.flush}
          />
        </label>
        {preparing ? (
          <p className={styles.busy} role="status">
            <span className={styles.spin} />
            {text.promptPreparing}
            <button type="button" className={styles.link} data-studio-prompt-cancel onClick={() => review.cancelVisualPrompt(itemId)}>
              {text.promptCancel}
            </button>
          </p>
        ) : null}
        {studio.promptState.status === "failed" ? (
          <p className={styles.cardError} role="alert">
            <b>{text.promptFailed}</b> {studio.promptState.message}{" "}
            <button type="button" className={styles.link} disabled={disabled} onClick={() => {
                flushFields();
                review.prepareVisualPrompt(itemId);
              }}>
              {text.promptRetry}
            </button>
          </p>
        ) : null}
        {!preparing && studio.promptState.status === "idle" && !studio.prompt.trim() ? (
          <p className={styles.vzHint} data-studio-unprepared>
            {text.promptEmpty}{" "}
            <button
              type="button"
              className={styles.link}
              title={text.promptPrepareTitle}
              disabled={disabled || !canPreparePrompt(studio)}
              data-studio-prepare
              onClick={() => {
                flushFields();
                review.prepareVisualPrompt(itemId);
              }}
            >
              {text.promptPrepare}
            </button>
          </p>
        ) : null}
        <div className={styles.vzRow} role="group" aria-label={text.style}>
          {styleOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cx(styles.chip, studio.style === option.value && styles.chipOn)}
              aria-pressed={studio.style === option.value}
              disabled={lockSettings}
              onClick={() => {
                flushFields();
                review.setStudioField(itemId, { style: option.value });
              }}
            >
              <i className={styles.sw} data-style={option.value} />
              {option.label}
            </button>
          ))}
        </div>
        {mismatch && studio.preparedFor ? (
          <p className={styles.cardNote} role="status" data-studio-mismatch>
            {text.promptMismatch(
              text.intents[studio.preparedFor.intent],
              styleOptions.find((option) => option.value === studio.preparedFor?.style)?.label ?? studio.preparedFor.style
            )}{" "}
            <button
              type="button"
              className={styles.link}
              title={text.promptRefreshTitle}
              disabled={disabled || !canPreparePrompt(studio)}
              data-studio-refresh
              onClick={() => {
                flushFields();
                review.prepareVisualPrompt(itemId);
              }}
            >
              {text.promptRefresh}
            </button>
          </p>
        ) : null}
        <label className={styles.vzField}>
          {text.caption}
          <input
            type="text"
            value={studio.caption}
            placeholder={text.captionPlaceholder}
            disabled={disabled}
            data-studio-caption
            onChange={(event) => captionField.change(event.target.value)}
            onBlur={captionField.flush}
          />
        </label>
        <div className={styles.vzRow}>
          <button
            type="button"
            className={styles.btn}
            disabled={disabled || !canGenerate(studio)}
            title={!studio.prompt.trim() ? text.generateNeedsPrompt : undefined}
            data-studio-generate
            onClick={() => {
                flushFields();
                review.generateVisual(itemId);
              }}
          >
            {studio.asset ? text.regenerate : text.generate}
          </button>
          {inText && figureBlockId ? (
            <>
              <button
                type="button"
                className={cx(styles.btn, styles.btnSolid)}
                disabled={!canPlace}
                title={blocker ?? undefined}
                data-studio-replace
                onClick={() => {
                flushFields();
                review.replaceVisual(itemId, shownAssetId);
              }}
              >
                {text.replace}
              </button>
              {captionChanged ? (
                <button
                  type="button"
                  className={cx(styles.btn, styles.btnOutline)}
                  disabled={disabled}
                  data-studio-caption-save
                  onClick={() => {
                flushFields();
                review.saveFigureCaption(figureBlockId, studio.caption);
              }}
                >
                  {text.captionSave}
                </button>
              ) : null}
              <span className={cx(styles.note, styles.noteOk)}>
                <V2Icon name="check" />
                {text.inText}
              </span>
              <button type="button" className={cx(styles.btn, styles.btnGhost)} disabled={disabled} onClick={() => review.removeVisual(itemId)}>
                {text.remove}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={cx(styles.btn, styles.btnSolid)}
                disabled={!canPlace}
                title={blocker ?? undefined}
                data-studio-insert
                onClick={() => {
                flushFields();
                review.insertVisual(itemId, shownAssetId);
              }}
              >
                {text.insert}
              </button>
              <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={() => review.rejectItem(itemId)}>
                {text.reject}
              </button>
            </>
          )}
        </div>
        {!canPlace && blocker ? (
          <p className={styles.vzHint} data-studio-blocker>
            {blocker}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A figure added by hand has no prompt behind it: the studio shows it and lets its caption be changed. */
function FigureCaptionStudio({ copy, review, blockId, disabled }: { copy: V2Copy; review: ReviewEngine; blockId: string; disabled: boolean }) {
  const text = copy.studio;
  const figure = review.readFigure(blockId);
  const { image } = useAssetImage(figure?.assetId || null);
  const [caption, setCaption] = useState(figure?.caption ?? "");

  if (!figure) {
    return (
      <p className={styles.cardError} role="alert">
        {text.figureGone}
      </p>
    );
  }

  return (
    <div className={styles.vz} data-studio-phase="manual">
      <div className={styles.vzView}>
        {image?.url ? (
          <div className={styles.shot} data-studio-preview="image">
            <img src={image.url} alt={figure.alt} draggable={false} />
          </div>
        ) : (
          <div className={styles.ph} data-studio-preview={image?.state === "missing" ? "missing" : "loading"}>
            <span>{image?.state === "missing" || !figure.assetId ? copy.imageMissing : text.previewLoading}</span>
          </div>
        )}
        {caption.trim() ? <p className={styles.vzCap}>{caption}</p> : null}
      </div>
      <div className={styles.vzForm}>
        <label className={styles.vzField}>
          {text.caption}
          <input
            type="text"
            value={caption}
            placeholder={text.captionPlaceholder}
            disabled={disabled}
            data-studio-caption
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
        <div className={styles.vzRow}>
          <button
            type="button"
            className={cx(styles.btn, styles.btnSolid)}
            disabled={disabled || caption.trim() === figure.caption.trim()}
            data-studio-caption-save
            onClick={() => review.saveFigureCaption(blockId, caption)}
          >
            {text.captionSave}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Whole seconds since `startedAt`, ticking while a generation is in flight. */
function useElapsedSeconds(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) {
      return;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
}
