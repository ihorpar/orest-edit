import type { PatchResponseDiagnostics, PatchOperation } from "../../lib/editor/patch-contract";
import type { EditorialReviewDiagnostics, EditorialReviewItem } from "../../lib/editor/review-contract";
import { EditorialReviewCard } from "../editor/EditorialReviewCard";
import { OperationCard } from "../editor/OperationCard";
import { Button } from "../ui/Button";

export interface RequestHistoryItem {
  id: string;
  timestampLabel: string;
  providerUsed: string;
  requestedProvider: string;
  requestedModelId: string;
  mode: "default" | "custom" | "review";
  resultCount: number;
  droppedCount: number;
  usedFallback: boolean;
  tone: "info" | "error";
  message: string;
}

export function RightOperationsRail({
  canRequestReview,
  isIdle,
  patchDiagnostics,
  reviewDiagnostics,
  history,
  onRequestReview,
  patchLoading,
  reviewLoading,
  onAccept,
  onAcceptAll,
  onFocusReviewItem,
  onReject,
  onRejectAll,
  operations,
  reviewItems,
  statusMessage,
  statusTone
}: {
  canRequestReview?: boolean;
  isIdle?: boolean;
  patchDiagnostics: PatchResponseDiagnostics | null;
  reviewDiagnostics: EditorialReviewDiagnostics | null;
  history: RequestHistoryItem[];
  onRequestReview: () => void;
  patchLoading?: boolean;
  reviewLoading?: boolean;
  onAccept: (id: string) => void;
  onAcceptAll: () => void;
  onFocusReviewItem: (item: EditorialReviewItem) => void;
  onReject: (id: string) => void;
  onRejectAll: () => void;
  operations: PatchOperation[];
  reviewItems: EditorialReviewItem[];
  statusMessage?: string;
  statusTone?: "info" | "error";
}) {
  const shouldShowFeedback = statusMessage && statusTone === "error";

  return (
    <div className="rail-stack" data-state={isIdle ? "idle" : "active"}>
      <section className="rail-section rail-section-primary">
        <p className="mono-ui operations-title">Огляд рукопису</p>
        <Button
          variant="primary"
          size="sm"
          onClick={onRequestReview}
          loading={reviewLoading}
          loadingLabel="Аналізую…"
          disabled={!canRequestReview}
          style={{ width: "100%" }}
        >
          Перевірити весь текст
        </Button>
        {shouldShowFeedback ? (
          <p className="rail-status-copy" data-tone={statusTone ?? "info"}>
            {statusMessage}
          </p>
        ) : null}
      </section>

      {reviewLoading || reviewItems.length > 0 ? (
        <section className="rail-section">
          <div className="rail-section-head">
            <p className="mono-ui operations-title">Редакторський огляд</p>
            {reviewItems.length > 0 ? <span className="mono-ui suggestion-card-lines">{reviewItems.length} рекомендацій</span> : null}
          </div>

          {reviewLoading ? <LoadingState label="Готую редакторський огляд…" /> : null}

          <div className="operations-stack operations-stack-compact">
            {reviewItems.map((item) => (
              <EditorialReviewCard key={item.id} item={item} onFocus={onFocusReviewItem} />
            ))}
          </div>
        </section>
      ) : null}

      {patchLoading || operations.length > 0 ? (
        <section className="rail-section">
          <div className="rail-section-head">
            <p className="mono-ui operations-title">Правки на розгляді</p>
            {operations.length > 1 ? (
              <div className="button-row">
                <Button variant="secondary" size="sm" onClick={onRejectAll}>
                  Відхилити всі
                </Button>
                <Button variant="primary" size="sm" onClick={onAcceptAll}>
                  Прийняти всі
                </Button>
              </div>
            ) : null}
          </div>

          {patchLoading ? <LoadingState label="Готую локальні правки…" /> : null}

          <div className="operations-stack">
            {operations.map((operation) => (
              <OperationCard key={operation.id} operation={operation} onAccept={onAccept} onReject={onReject} />
            ))}
          </div>
        </section>
      ) : null}

      {reviewDiagnostics ? (
        <details className="rail-disclosure">
          <summary className="mono-ui">Діагностика огляду</summary>
          <div className="disclosure-body">
            <div className="request-diagnostics-grid">
              <p className="editor-note-copy">
                <strong>Провайдер:</strong> {reviewDiagnostics.requestedProvider} → {reviewDiagnostics.requestedModelId}
              </p>
              <p className="editor-note-copy">
                <strong>Текст:</strong> {reviewDiagnostics.textLength} символів
              </p>
              <p className="editor-note-copy">
                <strong>Рекомендацій:</strong> {reviewDiagnostics.returnedItemCount}
              </p>
              <p className="editor-note-copy">
                <strong>Відкинуто:</strong> {reviewDiagnostics.droppedItemCount}
              </p>
            </div>
            {reviewDiagnostics.rawOutput ? (
              <details className="diagnostics-raw-output">
                <summary className="mono-ui">Raw output</summary>
                <pre className="diagnostics-raw-pre">{reviewDiagnostics.rawOutput}</pre>
              </details>
            ) : null}
          </div>
        </details>
      ) : null}

      {patchDiagnostics ? (
        <details className="rail-disclosure">
          <summary className="mono-ui">Діагностика правок</summary>
          <div className="disclosure-body">
            <div className="request-diagnostics-grid">
              <p className="editor-note-copy">
                <strong>Провайдер:</strong> {patchDiagnostics.requestedProvider} → {patchDiagnostics.requestedModelId}
              </p>
              <p className="editor-note-copy">
                <strong>Режим:</strong> {patchDiagnostics.appliedMode === "custom" ? "кастомний" : "базовий"}
              </p>
              <p className="editor-note-copy">
                <strong>Виділення:</strong> {patchDiagnostics.selectionLength} символів
              </p>
              <p className="editor-note-copy">
                <strong>Правок:</strong> {patchDiagnostics.returnedOperationCount}
              </p>
              <p className="editor-note-copy">
                <strong>Відкинуто:</strong> {patchDiagnostics.droppedOperationCount}
              </p>
            </div>
          </div>
        </details>
      ) : null}

      {history.length > 0 ? (
        <details className="rail-disclosure">
          <summary className="mono-ui">Останні запити</summary>
          <div className="disclosure-body request-history-stack">
            {history.map((entry) => (
              <article key={entry.id} className="editor-note-card request-status-card" data-tone={entry.tone}>
                <div className="request-history-head">
                  <p className="editor-note-title">{entry.timestampLabel}</p>
                  <span className="mono-ui request-history-badge">{entry.resultCount}</span>
                </div>
                <p className="editor-note-copy">{entry.message}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="operations-empty loading-state-card" role="status" aria-live="polite">
      <span className="loading-inline-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="mono-ui">{label}</span>
    </div>
  );
}
