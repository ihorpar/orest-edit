"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUp, LoaderCircle, X } from "lucide-react";
import {
  getLocalActionTextIntentOptions,
  type LocalActionExecutor,
  type LocalActionMode,
  type LocalActionRouteResponse,
  type SuggestedLocalActionMode,
  type LocalActionTextIntent
} from "../../lib/editor/local-action-router";
import {
  getEditorialCalloutDepthOptions,
  getEditorialCalloutKindOptions,
  getEditorialVisualIntentOptions,
  type EditorialCalloutDepth,
  type EditorialCalloutKind,
  type EditorialVisualIntent,
  type VisualStylePreset,
  type WholeTextChangeLevel
} from "../../lib/editor/review-contract";
import { getVisualStylePresetOptions } from "../../lib/editor/settings";
import { type SpellcheckBlockResult } from "../../lib/editor/spellcheck-view-model";

const reviewLevelOptions: Array<{ level: WholeTextChangeLevel; label: string; description: string }> = [
  { level: 1, label: "1", description: "Мінімальні зауваги" },
  { level: 2, label: "2", description: "Легке шліфування" },
  { level: 3, label: "3", description: "Помірне редакторське втручання" },
  { level: 4, label: "4", description: "Суттєве перепакування" },
  { level: 5, label: "5", description: "Максимально глибокий огляд" }
];

type LocalSurfaceMode = "edit" | "proof" | "callout" | "visual";

const LOCAL_SURFACE_MODE_LABELS: Record<LocalSurfaceMode, string> = {
  edit: "Правка",
  proof: "Правопис",
  callout: "Врізка",
  visual: "Візуал"
};

interface FloatingBridgePosition {
  x: number;
  y: number;
}

interface FloatingBridgeDragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

const FLOATING_BRIDGE_VIEWPORT_MARGIN = 16;
const FLOATING_BRIDGE_TOP_CLEARANCE = 76;
const FLOATING_BRIDGE_POSITION_STORAGE_KEY = "orest-floating-bridge-position-v1";

export function FloatingComposerPanel({
  mode,
  customPrompt,
  onCustomPromptChange,
  localTextIntent,
  localActionRoute,
  onLocalTextIntentChange,
  onRequestAutoAction,
  reviewChangeLevel,
  reviewAdditionalInstructions,
  onReviewChangeLevel,
  onReviewAdditionalInstructionsChange,
  onRequestReview,
  patchLoading,
  reviewLoading,
  localActionMode,
  onLocalActionModeChange,
  manualCalloutKind,
  manualCalloutDepth,
  manualVisualIntent,
  manualVisualStylePreset,
  onManualCalloutKindChange,
  onManualCalloutDepthChange,
  onManualVisualIntentChange,
  onManualVisualStylePresetChange,
  manualCalloutPrompt,
  manualVisualPrompt,
  spellcheckResults,
  spellcheckLoading,
  spellcheckSummary,
  spellcheckSecondarySummary,
  localModeSuggestion,
  onManualCalloutPromptChange,
  onManualVisualPromptChange,
  onRequestManualCallout,
  onRequestManualVisual,
  onRequestSpellcheck,
  manualLoadingKind,
  isClosing = false,
  onClose
}: {
  mode: "local" | "review";
  customPrompt: string;
  onCustomPromptChange: (value: string) => void;
  localTextIntent: LocalActionTextIntent;
  localActionRoute: LocalActionRouteResponse;
  onLocalTextIntentChange: (intent: LocalActionTextIntent) => void;
  onRequestAutoAction: () => void;
  reviewChangeLevel: WholeTextChangeLevel;
  reviewAdditionalInstructions: string;
  onReviewChangeLevel: (level: WholeTextChangeLevel) => void;
  onReviewAdditionalInstructionsChange: (value: string) => void;
  onRequestReview: () => void;
  patchLoading?: boolean;
  reviewLoading?: boolean;
  localActionMode: LocalActionMode;
  onLocalActionModeChange: (mode: LocalActionMode) => void;
  manualCalloutKind: EditorialCalloutKind;
  manualCalloutDepth: EditorialCalloutDepth;
  manualVisualIntent: EditorialVisualIntent;
  manualVisualStylePreset: VisualStylePreset;
  onManualCalloutKindChange: (value: EditorialCalloutKind) => void;
  onManualCalloutDepthChange: (value: EditorialCalloutDepth) => void;
  onManualVisualIntentChange: (value: EditorialVisualIntent) => void;
  onManualVisualStylePresetChange: (value: VisualStylePreset) => void;
  manualCalloutPrompt: string;
  manualVisualPrompt: string;
  spellcheckResults: SpellcheckBlockResult[];
  spellcheckLoading?: boolean;
  spellcheckSummary?: string | null;
  spellcheckSecondarySummary?: string | null;
  localModeSuggestion?: { mode: SuggestedLocalActionMode; label: string } | null;
  onManualCalloutPromptChange: (value: string) => void;
  onManualVisualPromptChange: (value: string) => void;
  onRequestManualCallout: () => void;
  onRequestManualVisual: () => void;
  onRequestSpellcheck: () => void;
  manualLoadingKind?: "callout" | "visual" | "list" | "subsection" | null;
  isClosing?: boolean;
  onClose: () => void;
}) {
  const isReview = mode === "review";
  const calloutOptions = getEditorialCalloutKindOptions();
  const calloutDepthOptions = getEditorialCalloutDepthOptions();
  const visualOptions = getEditorialVisualIntentOptions();
  const visualStyleOptions = getVisualStylePresetOptions();
  const manualInFlight = Boolean(manualLoadingKind);
  const localBusy = Boolean(patchLoading || manualInFlight || spellcheckLoading);
  const primaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoCalloutTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoVisualTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const calloutTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const visualTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const reviewTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const floatingBridgeShellRef = useRef<HTMLElement | null>(null);
  const floatingBridgeDragStateRef = useRef<FloatingBridgeDragState | null>(null);
  const [floatingBridgePosition, setFloatingBridgePosition] = useState<FloatingBridgePosition | null>(null);
  const [hasCustomFloatingBridgePosition, setHasCustomFloatingBridgePosition] = useState(false);
  const [isDraggingFloatingBridge, setIsDraggingFloatingBridge] = useState(false);
  const textIntentOptions = getLocalActionTextIntentOptions();
  const showAutoTextModes =
    localActionRoute.executor === "patch" || localActionRoute.executor === "review" || localActionRoute.executor === "clarify";
  const localSurfaceMode = useMemo<LocalSurfaceMode>(() => {
    if (localActionMode === "edit" || localActionMode === "auto") {
      return "edit";
    }

    if (localActionMode === "spellcheck") {
      return "proof";
    }

    if (localActionMode === "callout") {
      return "callout";
    }

    if (localActionMode === "visual") {
      return "visual";
    }

    return "edit";
  }, [localActionMode]);

  useAutosizeTextarea(primaryTextareaRef, customPrompt, !isReview && localSurfaceMode === "edit");
  useAutosizeTextarea(autoCalloutTextareaRef, customPrompt, !isReview && localSurfaceMode === "callout" && localActionMode !== "callout");
  useAutosizeTextarea(autoVisualTextareaRef, customPrompt, !isReview && localSurfaceMode === "visual" && localActionMode !== "visual");
  useAutosizeTextarea(calloutTextareaRef, manualCalloutPrompt, !isReview && localSurfaceMode === "callout" && localActionMode === "callout");
  useAutosizeTextarea(visualTextareaRef, manualVisualPrompt, !isReview && localSurfaceMode === "visual" && localActionMode === "visual");
  useAutosizeTextarea(reviewTextareaRef, reviewAdditionalInstructions, isReview);

  useLayoutEffect(() => {
    if (isReview) {
      return;
    }

    const node = floatingBridgeShellRef.current;

    if (!node) {
      return;
    }

    const storedPosition = readStoredFloatingBridgePosition();
    const rect = node.getBoundingClientRect();
    const initialPosition = clampFloatingBridgePosition(
      storedPosition ?? getDefaultFloatingBridgePosition(rect.width, rect.height),
      rect.width,
      rect.height
    );

    setFloatingBridgePosition(initialPosition);
    setHasCustomFloatingBridgePosition(storedPosition !== null);
  }, [isReview]);

  useEffect(() => {
    if (isReview || !floatingBridgePosition) {
      return;
    }

    if (hasCustomFloatingBridgePosition) {
      window.sessionStorage.setItem(FLOATING_BRIDGE_POSITION_STORAGE_KEY, JSON.stringify(floatingBridgePosition));
      return;
    }

    window.sessionStorage.removeItem(FLOATING_BRIDGE_POSITION_STORAGE_KEY);
  }, [floatingBridgePosition, hasCustomFloatingBridgePosition, isReview]);

  useEffect(() => {
    if (isReview) {
      return;
    }

    function syncFloatingBridgeToViewport() {
      const node = floatingBridgeShellRef.current;

      if (!node) {
        return;
      }

      const rect = node.getBoundingClientRect();

      setFloatingBridgePosition((current) => {
        const nextBase =
          hasCustomFloatingBridgePosition && current
            ? current
            : getDefaultFloatingBridgePosition(rect.width, rect.height);

        return clampFloatingBridgePosition(nextBase, rect.width, rect.height);
      });
    }

    const visualViewport = window.visualViewport;

    window.addEventListener("resize", syncFloatingBridgeToViewport);
    visualViewport?.addEventListener("resize", syncFloatingBridgeToViewport);
    visualViewport?.addEventListener("scroll", syncFloatingBridgeToViewport);

    const node = floatingBridgeShellRef.current;
    let resizeFrame: number | null = null;
    const scheduleSyncFloatingBridgeToViewport = () => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }

      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        syncFloatingBridgeToViewport();
      });
    };
    const resizeObserver = typeof ResizeObserver === "undefined" || !node
      ? null
      : new ResizeObserver(() => {
        scheduleSyncFloatingBridgeToViewport();
      });

    if (resizeObserver && node) {
      resizeObserver.observe(node);
    }

    return () => {
      window.removeEventListener("resize", syncFloatingBridgeToViewport);
      visualViewport?.removeEventListener("resize", syncFloatingBridgeToViewport);
      visualViewport?.removeEventListener("scroll", syncFloatingBridgeToViewport);
      resizeObserver?.disconnect();

      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
    };
  }, [hasCustomFloatingBridgePosition, isReview]);

  const spellcheckStatusCopy =
    spellcheckSummary ??
    (spellcheckLoading
      ? "Перевіряємо вибрані текстові блоки."
      : "Перевірити виділений фрагмент через LanguageTool і показати проблеми в рукописі.");
  const autoCalloutPromptValue = localActionMode === "callout" ? manualCalloutPrompt : customPrompt;
  const autoVisualPromptValue = localActionMode === "visual" ? manualVisualPrompt : customPrompt;
  const isExplicitSpecialMode = localActionMode === "callout" || localActionMode === "visual";
  const sendLabel =
    localActionMode === "callout"
      ? "Підготувати врізку"
      : localActionMode === "visual"
        ? "Підготувати візуал"
        : localActionMode === "spellcheck"
          ? "Перевірити правопис"
          : localActionRoute.actionLabel;

  function isExecutorLoading(executor: LocalActionExecutor) {
    if (executor === "patch") {
      return Boolean(patchLoading);
    }

    if (executor === "review") {
      return manualLoadingKind === "list" || manualLoadingKind === "subsection";
    }

    if (executor === "spellcheck") {
      return Boolean(spellcheckLoading);
    }

    if (executor === "callout") {
      return manualLoadingKind === "callout";
    }

    if (executor === "visual") {
      return manualLoadingKind === "visual";
    }

    return false;
  }

  const editSendLoading = !isReview && localSurfaceMode === "edit" ? isExecutorLoading(localActionRoute.executor) : false;
  const proofSendLoading = Boolean(spellcheckLoading);
  const calloutSendLoading =
    localActionMode === "callout"
      ? manualLoadingKind === "callout"
      : !isReview && localActionRoute.executor === "callout" && manualLoadingKind === "callout";
  const visualSendLoading =
    localActionMode === "visual"
      ? manualLoadingKind === "visual"
      : !isReview && localActionRoute.executor === "visual" && manualLoadingKind === "visual";

  function renderSendIcon(isLoading: boolean) {
    if (isLoading) {
      return <LoaderCircle size={15} className="floating-bridge-send-spinner" />;
    }

    return <ArrowUp size={15} />;
  }

  function handleModeSelect(nextMode: LocalSurfaceMode) {
    onLocalActionModeChange(
      nextMode === "edit" ? "edit" : nextMode === "proof" ? "spellcheck" : nextMode
    );
  }

  function handleFloatingBridgePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;

    if (!target || target.closest("button, textarea, select, input, label")) {
      return;
    }

    const node = floatingBridgeShellRef.current;

    if (!node) {
      return;
    }

    const rect = node.getBoundingClientRect();
    floatingBridgeDragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false
    };
    setIsDraggingFloatingBridge(true);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleFloatingBridgePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = floatingBridgeDragStateRef.current;
    const node = floatingBridgeShellRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId || !node) {
      return;
    }

    const rect = node.getBoundingClientRect();
    const nextPosition = clampFloatingBridgePosition(
      {
        x: event.clientX - dragState.offsetX,
        y: event.clientY - dragState.offsetY
      },
      rect.width,
      rect.height
    );

    if (
      !dragState.moved &&
      (Math.abs(event.clientX - dragState.startClientX) > 2 || Math.abs(event.clientY - dragState.startClientY) > 2)
    ) {
      dragState.moved = true;
      setHasCustomFloatingBridgePosition(true);
    }

    setFloatingBridgePosition(nextPosition);
  }

  function handleFloatingBridgePointerRelease(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = floatingBridgeDragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    floatingBridgeDragStateRef.current = null;
    setIsDraggingFloatingBridge(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (!isReview) {
    const floatingBridgeStyle =
      floatingBridgePosition === null
        ? undefined
        : {
            left: 0,
            top: 0,
            bottom: "auto",
            transform: `translate3d(${Math.round(floatingBridgePosition.x)}px, ${Math.round(floatingBridgePosition.y)}px, 0)`
          };

    return (
      <section
        ref={floatingBridgeShellRef}
        className="floating-bridge-shell"
        data-state={isClosing ? "closing" : "open"}
        data-positioned={floatingBridgePosition ? "true" : "false"}
        aria-label="Локальна правка"
        style={floatingBridgeStyle}
      >
        <div className="floating-bridge-surface" data-mode={localSurfaceMode}>
          <div
            className="floating-bridge-top"
            data-dragging={isDraggingFloatingBridge ? "true" : "false"}
            onPointerDown={handleFloatingBridgePointerDown}
            onPointerMove={handleFloatingBridgePointerMove}
            onPointerUp={handleFloatingBridgePointerRelease}
            onPointerCancel={handleFloatingBridgePointerRelease}
            onLostPointerCapture={handleFloatingBridgePointerRelease}
          >
            <div className="floating-bridge-mode-tabs" role="tablist" aria-label="Режими локальної дії">
              {(["edit", "proof", "callout", "visual"] as LocalSurfaceMode[]).map((surfaceMode) => (
                <button
                  key={surfaceMode}
                  type="button"
                  role="tab"
                  aria-selected={localSurfaceMode === surfaceMode}
                  className="floating-bridge-mode-tab"
                  data-active={localSurfaceMode === surfaceMode ? "true" : "false"}
                  data-suggested={
                    localModeSuggestion?.mode ===
                    (surfaceMode === "proof" ? "spellcheck" : surfaceMode === "callout" ? "callout" : surfaceMode === "visual" ? "visual" : null)
                      ? "true"
                      : "false"
                  }
                  onClick={() => handleModeSelect(surfaceMode)}
                  disabled={localBusy}
                >
                  {LOCAL_SURFACE_MODE_LABELS[surfaceMode]}
                </button>
              ))}
            </div>
            <button type="button" className="floating-bridge-close" onClick={onClose} aria-label="Закрити панель" title="Закрити">
              <X size={14} />
            </button>
          </div>

          <div className="floating-bridge-mode-shell">
            <section className="floating-bridge-mode-panel" data-active={localSurfaceMode === "edit" ? "true" : "false"}>
              <div className="floating-bridge-main">
                <div className="floating-bridge-textarea-shell" data-working={editSendLoading ? "true" : "false"}>
                  <textarea
                    ref={primaryTextareaRef}
                    className="floating-bridge-textarea"
                    rows={2}
                    placeholder="Що зробити з виділеним?"
                    value={customPrompt}
                    onChange={(event) => onCustomPromptChange(event.currentTarget.value)}
                    disabled={localBusy}
                  />
                </div>
                {localActionRoute.executor === "clarify" ? (
                  <div className="floating-bridge-clarify">
                    <span className="floating-bridge-clarify-label">Уточніть дію</span>
                    <div className="floating-bridge-clarify-row">
                      <button type="button" className="floating-bridge-clarify-button" onClick={() => onLocalTextIntentChange("rewrite")}>
                        Правка
                      </button>
                      <button type="button" className="floating-bridge-clarify-button" onClick={() => handleModeSelect("callout")}>
                        Врізка
                      </button>
                      <button type="button" className="floating-bridge-clarify-button" onClick={() => handleModeSelect("visual")}>
                        Візуал
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="floating-bridge-footer">
                <div className="floating-bridge-footer-left">
                  {showAutoTextModes ? (
                    <div className="floating-bridge-segmented" role="tablist" aria-label="Режим текстової дії">
                      {textIntentOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="tab"
                          aria-selected={localTextIntent === option.value}
                          className="floating-bridge-segmented-option"
                          data-active={localTextIntent === option.value ? "true" : "false"}
                          onClick={() => onLocalTextIntentChange(option.value)}
                          disabled={localBusy}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="floating-bridge-segmented floating-bridge-segmented-ghost">
                      <button type="button" className="floating-bridge-segmented-option" disabled>
                        {getLocalActionTextIntentOptions().find((option) => option.value === localTextIntent)?.label ?? "Переписати"}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="floating-bridge-send"
                  onClick={onRequestAutoAction}
                  disabled={localBusy}
                  data-loading={editSendLoading ? "true" : "false"}
                  aria-busy={editSendLoading}
                  aria-label={sendLabel}
                  title={sendLabel}
                >
                  <span className="floating-bridge-send-content">
                    {renderSendIcon(editSendLoading)}
                  </span>
                </button>
              </div>
            </section>

            <section className="floating-bridge-mode-panel" data-active={localSurfaceMode === "proof" ? "true" : "false"}>
              <div className="floating-bridge-main">
                <p className="floating-bridge-status-copy">{spellcheckStatusCopy}</p>
                {spellcheckSecondarySummary ? <p className="floating-bridge-status-copy floating-bridge-status-copy-secondary">{spellcheckSecondarySummary}</p> : null}
                {spellcheckResults.length > 0 ? (
                  <p className="floating-bridge-status-copy floating-bridge-status-copy-secondary">Проблемні блоки вже підсвічено в рукописі.</p>
                ) : null}
              </div>
              <div className="floating-bridge-footer">
                <div className="floating-bridge-footer-left" />
                <button
                  type="button"
                  className="floating-bridge-send"
                  onClick={localActionMode === "spellcheck" ? onRequestSpellcheck : onRequestAutoAction}
                  disabled={localActionMode === "spellcheck" ? Boolean(spellcheckLoading) : localBusy}
                  data-loading={proofSendLoading ? "true" : "false"}
                  aria-busy={proofSendLoading}
                  aria-label={sendLabel}
                  title={sendLabel}
                >
                  <span className="floating-bridge-send-content">
                    {renderSendIcon(proofSendLoading)}
                  </span>
                </button>
              </div>
            </section>

            <section className="floating-bridge-mode-panel" data-active={localSurfaceMode === "callout" ? "true" : "false"}>
              <div className="floating-bridge-main">
                <div className="floating-bridge-textarea-shell" data-working={calloutSendLoading ? "true" : "false"}>
                  <textarea
                    ref={localActionMode === "callout" ? calloutTextareaRef : autoCalloutTextareaRef}
                    className="floating-bridge-textarea"
                    rows={2}
                    placeholder="Що саме підкреслити у врізці..."
                    value={autoCalloutPromptValue}
                    onChange={(event) =>
                      localActionMode === "callout"
                        ? onManualCalloutPromptChange(event.currentTarget.value)
                        : onCustomPromptChange(event.currentTarget.value)
                    }
                    disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                  />
                </div>
              </div>
              <div className="floating-bridge-footer">
                <div className="floating-bridge-footer-left">
                  <div className="floating-bridge-select-shell">
                    <select
                      value={manualCalloutKind}
                      onChange={(event) => onManualCalloutKindChange(event.target.value as EditorialCalloutKind)}
                      disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                      aria-label="Тип врізки"
                    >
                      {calloutOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="floating-bridge-select-shell">
                    <select
                      value={manualCalloutDepth}
                      onChange={(event) => onManualCalloutDepthChange(event.target.value as EditorialCalloutDepth)}
                      disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                      aria-label="Глибина врізки"
                    >
                      {calloutDepthOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="floating-bridge-send"
                  onClick={localActionMode === "callout" ? onRequestManualCallout : onRequestAutoAction}
                  disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                  data-loading={calloutSendLoading ? "true" : "false"}
                  aria-busy={calloutSendLoading}
                  aria-label={sendLabel}
                  title={sendLabel}
                >
                  <span className="floating-bridge-send-content">
                    {renderSendIcon(calloutSendLoading)}
                  </span>
                </button>
              </div>
            </section>

            <section className="floating-bridge-mode-panel" data-active={localSurfaceMode === "visual" ? "true" : "false"}>
              <div className="floating-bridge-main">
                <div className="floating-bridge-textarea-shell" data-working={visualSendLoading ? "true" : "false"}>
                  <textarea
                    ref={localActionMode === "visual" ? visualTextareaRef : autoVisualTextareaRef}
                    className="floating-bridge-textarea"
                    rows={2}
                    placeholder="Що саме має показати візуал..."
                    value={autoVisualPromptValue}
                    onChange={(event) =>
                      localActionMode === "visual"
                        ? onManualVisualPromptChange(event.currentTarget.value)
                        : onCustomPromptChange(event.currentTarget.value)
                    }
                    disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                  />
                </div>
              </div>
              <div className="floating-bridge-footer">
                <div className="floating-bridge-footer-left">
                  <div className="floating-bridge-segmented floating-bridge-segmented-compact">
                    {visualOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="floating-bridge-segmented-option"
                        data-active={manualVisualIntent === option.value ? "true" : "false"}
                        onClick={() => onManualVisualIntentChange(option.value)}
                        disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="floating-bridge-select-shell">
                    <select
                      value={manualVisualStylePreset}
                      onChange={(event) => onManualVisualStylePresetChange(event.target.value as VisualStylePreset)}
                      disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                      aria-label="Стиль візуалу"
                    >
                      {visualStyleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="floating-bridge-send"
                  onClick={localActionMode === "visual" ? onRequestManualVisual : onRequestAutoAction}
                  disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                  data-loading={visualSendLoading ? "true" : "false"}
                  aria-busy={visualSendLoading}
                  aria-label={sendLabel}
                  title={sendLabel}
                >
                  <span className="floating-bridge-send-content">
                    {renderSendIcon(visualSendLoading)}
                  </span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="floating-panel"
      data-mode={mode}
      data-state={isClosing ? "closing" : "open"}
      data-collapsed="false"
      aria-label={isReview ? "Огляд документа" : "Локальна правка"}
    >
      <header className="floating-panel-header">
        <div className="floating-panel-title-stack">
          <p className="mono-ui">{isReview ? "Огляд документа" : "Локальні дії"}</p>
          <div className="floating-panel-question">
            {isReview
              ? "Наскільки глибоко перевірити документ?"
              : localActionMode === "auto"
                ? "Виконайте локальну дію для виділеного фрагмента"
                : localActionMode === "spellcheck"
                  ? "Перевірте правопис у виділеному фрагменті"
                  : localActionMode === "callout"
                    ? "Підготуйте врізку для виділеного фрагмента"
                    : "Підготуйте візуал для виділеного фрагмента"}
          </div>
        </div>
        <div className="floating-panel-header-actions">
          <button type="button" className="panel-toggle" onClick={onClose} aria-label="Закрити панель" title="Закрити">
            ×
          </button>
        </div>
      </header>

      <div className="floating-panel-body">
        <div className="floating-review-body">
            <div className="floating-review-scale">
              {reviewLevelOptions.map((option) => (
                <button
                  key={option.level}
                  type="button"
                  className="floating-review-scale-button"
                  data-active={reviewChangeLevel === option.level ? "true" : "false"}
                  onClick={() => onReviewChangeLevel(option.level)}
                >
                  <span className="mono-ui">{option.label}</span>
                </button>
              ))}
            </div>
            <p className="floating-review-description">
              {reviewLevelOptions.find((option) => option.level === reviewChangeLevel)?.description}
            </p>
            <div className="floating-textarea-shell">
              <textarea
                ref={reviewTextareaRef}
                className="floating-textarea"
                rows={3}
                placeholder="Додаткові інструкції для огляду"
                value={reviewAdditionalInstructions}
                onChange={(event) => onReviewAdditionalInstructionsChange(event.currentTarget.value)}
              />
            </div>
            <div className="floating-footer">
              <div />
              <div className="send-row">
                <button type="button" className="send-button mono-ui" onClick={onRequestReview} disabled={reviewLoading} aria-label="Запустити огляд" title="Запустити огляд">
                  {reviewLoading ? "…" : "→"}
                </button>
              </div>
            </div>
          </div>
      </div>
    </section>
  );
}

function useAutosizeTextarea(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, isActive: boolean) {
  useLayoutEffect(() => {
    const node = ref.current;

    if (!node || !isActive) {
      return;
    }

    node.style.height = "auto";
    const styles = window.getComputedStyle(node);
    const lineHeight = Number.parseFloat(styles.lineHeight || "22");
    const paddingTop = Number.parseFloat(styles.paddingTop || "0");
    const paddingBottom = Number.parseFloat(styles.paddingBottom || "0");
    const minHeight = lineHeight * Math.max(node.rows, 2) + paddingTop + paddingBottom;
    const maxHeight = lineHeight * 5 + paddingTop + paddingBottom;
    const nextHeight = Math.max(minHeight, Math.min(node.scrollHeight, maxHeight));
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [isActive, ref, value]);
}

function readStoredFloatingBridgePosition(): FloatingBridgePosition | null {
  try {
    const rawValue = window.sessionStorage.getItem(FLOATING_BRIDGE_POSITION_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<FloatingBridgePosition>;

    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      return null;
    }

    return parsed as FloatingBridgePosition;
  } catch {
    return null;
  }
}

function getDefaultFloatingBridgePosition(panelWidth: number, panelHeight: number): FloatingBridgePosition {
  const viewportBounds = getFloatingBridgeViewportBounds();

  return clampFloatingBridgePosition(
    {
      x: viewportBounds.left + (viewportBounds.width - panelWidth) / 2,
      y: viewportBounds.top + viewportBounds.height - panelHeight
    },
    panelWidth,
    panelHeight
  );
}

function clampFloatingBridgePosition(position: FloatingBridgePosition, panelWidth: number, panelHeight: number): FloatingBridgePosition {
  const viewportBounds = getFloatingBridgeViewportBounds();
  const maxX = viewportBounds.left + Math.max(0, viewportBounds.width - panelWidth);
  const maxY = viewportBounds.top + Math.max(0, viewportBounds.height - panelHeight);

  return {
    x: Math.min(Math.max(position.x, viewportBounds.left), maxX),
    y: Math.min(Math.max(position.y, viewportBounds.top), maxY)
  };
}

function getFloatingBridgeViewportBounds() {
  const visualViewport = window.visualViewport;
  const left = (visualViewport?.offsetLeft ?? 0) + FLOATING_BRIDGE_VIEWPORT_MARGIN;
  const top = (visualViewport?.offsetTop ?? 0) + FLOATING_BRIDGE_TOP_CLEARANCE;
  const width = (visualViewport?.width ?? window.innerWidth) - FLOATING_BRIDGE_VIEWPORT_MARGIN * 2;
  const height = (visualViewport?.height ?? window.innerHeight) - FLOATING_BRIDGE_TOP_CLEARANCE - FLOATING_BRIDGE_VIEWPORT_MARGIN;

  return {
    left,
    top,
    width: Math.max(width, 0),
    height: Math.max(height, 0)
  };
}
