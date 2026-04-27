import type { PatchResponseDiagnostics, PatchOperation } from "../../lib/editor/patch-contract";
import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import {
  getEditorialRecommendationTypeLabel,
  getReviewParagraphRangeLabel,
  type EditorialReviewDiagnostics,
  type EditorialReviewItem,
  type EditorialReviewRecommendationType
} from "../../lib/editor/review-contract";
import { getAiActivityTaskMessage, getAiActivityTaskTone, type AiActivityTask } from "../../lib/editor/ai-activity";
import { EditorialReviewCard } from "../editor/EditorialReviewCard";
import { OperationCard } from "../editor/OperationCard";
import { Button } from "../ui/Button";

export interface RequestHistoryItem {
  id: string;
  timestampLabel: string;
  providerUsed: string;
  requestedProvider: string;
  requestedModelId: string;
  mode: "default" | "custom" | "review" | "proposal" | "image" | "spellcheck";
  resultCount: number;
  droppedCount: number;
  usedFallback: boolean;
  tone: "info" | "error";
  message: string;
}

function formatFilteredTypeCounts(
  counts?: Partial<Record<EditorialReviewRecommendationType, number>>
): string | null {
  if (!counts) {
    return null;
  }

  const entries: string[] = [];

  for (const type of Object.keys(counts) as EditorialReviewRecommendationType[]) {
    const count = counts[type];

    if (typeof count !== "number" || count <= 0) {
      continue;
    }

    entries.push(`${getEditorialRecommendationTypeLabel(type)} × ${count}`);
  }

  return entries.length > 0 ? entries.join(", ") : null;
}

export function RightOperationsRail({
  aiTasks,
  canRequestReview,
  canOpenLocalComposer,
  isIdle,
  patchDiagnostics,
  reviewDiagnostics,
  reviewItems,
  reviewRevision,
  activeReviewItemId,
  history,
  isReviewDrawerOpen,
  onOpenReviewDrawer,
  onCloseReviewDrawer,
  onOpenLocalComposer,
  onFocusReviewItem,
  onPrepareReviewItem,
  onApplyReviewCallout,
  preparingReviewItemId,
  onDismissReviewItem,
  reviewLoading,
  onAccept,
  onAcceptAll,
  onReject,
  onRejectAll,
  operations,
  reviewItemCount,
  statusMessage,
  statusTone,
  onOpenAiTask,
  onDismissAiTask
}: {
  aiTasks: AiActivityTask[];
  canRequestReview?: boolean;
  canOpenLocalComposer?: boolean;
  isIdle?: boolean;
  patchDiagnostics: PatchResponseDiagnostics | null;
  reviewDiagnostics: EditorialReviewDiagnostics | null;
  reviewItems: EditorialReviewItem[];
  reviewRevision: ManuscriptRevisionState;
  activeReviewItemId?: string | null;
  preparingReviewItemId?: string | null;
  history: RequestHistoryItem[];
  isReviewDrawerOpen?: boolean;
  onOpenReviewDrawer: () => void;
  onCloseReviewDrawer: () => void;
  onOpenLocalComposer: () => void;
  onFocusReviewItem: (item: EditorialReviewItem) => void;
  onPrepareReviewItem: (item: EditorialReviewItem) => void;
  onApplyReviewCallout: (item: EditorialReviewItem) => void;
  onDismissReviewItem: (item: EditorialReviewItem) => void;
  reviewLoading?: boolean;
  onAccept: (id: string) => void;
  onAcceptAll: () => void;
  onReject: (id: string) => void;
  onRejectAll: () => void;
  operations: PatchOperation[];
  reviewItemCount: number;
  statusMessage?: string;
  statusTone?: "info" | "error";
  onOpenAiTask: (task: AiActivityTask) => void;
  onDismissAiTask: (taskId: string) => void;
}) {
  const reviewItemByProposalId = new Map(
    reviewItems
      .filter((item) => item.activeProposalId)
      .map((item) => [item.activeProposalId as string, item])
  );
  const filteredTypeSummary = formatFilteredTypeCounts(reviewDiagnostics?.filteredItemCountsByType);

  return (
    <div className="rail-stack" data-state={isIdle ? "idle" : "active"}>
      <div className="sidebar-toggle-row">
        <button
          className="sidebar-toggle-button"
          data-active={isReviewDrawerOpen ? "true" : "false"}
          onClick={onOpenReviewDrawer}
        >
          AI
        </button>
        <button
          className="sidebar-toggle-button"
          data-active={!isReviewDrawerOpen ? "true" : "false"}
          onClick={onCloseReviewDrawer}
        >
          Картки
        </button>
      </div>

      <section className="rail-section rail-section-primary">
        <p className="mono-ui operations-title">Огляд документа</p>
        <Button variant="primary" size="sm" onClick={onOpenReviewDrawer} loading={reviewLoading} disabled={!canRequestReview} style={{ width: '100%' }}>
          Аналіз ШІ
        </Button>
        {reviewItemCount > 0 ? <p className="rail-status-copy">Рекомендацій: {reviewItemCount}</p> : null}
        {statusMessage ? (
          <p className="rail-status-copy" data-tone={statusTone ?? "info"}>
            {statusMessage}
          </p>
        ) : null}
      </section>

      {aiTasks.length > 0 ? (
        <section className="rail-section">
          <p className="mono-ui operations-title">ШІ</p>
          <div className="request-history-stack">
            {aiTasks.map((task) => (
              <article key={task.id} className="editor-note-card" data-tone={getAiActivityTaskTone(task)}>
                <p className="editor-note-title">{task.title}</p>
                <p className="editor-note-copy">{getAiActivityTaskMessage(task)}</p>
                <div className="button-row">
                  <Button size="sm" variant="secondary" onClick={() => onOpenAiTask(task)}>
                    Відкрити
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDismissAiTask(task.id)}>
                    ×
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {operations.length > 0 ? (
        <section className="rail-section">
          <div className="rail-section-head">
            <p className="mono-ui operations-title">Правки</p>
            {operations.length > 1 ? (
              <div className="button-row">
                <Button size="sm" variant="ghost" onClick={onRejectAll}>
                  Скасувати всі
                </Button>
                <Button size="sm" variant="primary" onClick={onAcceptAll}>
                  Прийняти всі
                </Button>
              </div>
            ) : null}
          </div>
          <div className="operations-stack">
            {operations.map((operation) => {
              const sourceItem = reviewItemByProposalId.get(operation.id);
              return (
                <OperationCard
                  key={operation.id}
                  operation={operation}
                  context={
                    sourceItem
                      ? {
                        recommendation: sourceItem.recommendation,
                        reason: sourceItem.reason,
                        paragraphLabel: getReviewParagraphRangeLabel(sourceItem, reviewRevision)
                      }
                      : undefined
                  }
                  onAccept={onAccept}
                  onReject={onReject}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {reviewItems.filter(item => item.status !== 'dismissed').length > 0 ? (
        <section className="rail-section">
          <p className="mono-ui operations-title">Рекомендації</p>
          <div className="operations-stack operations-stack-compact">
            {reviewItems.filter(item => item.status !== 'dismissed').map((item) => (
              <EditorialReviewCard
                key={item.id}
                item={item}
                revision={reviewRevision}
                isActive={item.id === activeReviewItemId}
                onFocus={onFocusReviewItem}
                onPrepare={onPrepareReviewItem}
                onApplyCallout={onApplyReviewCallout}
                onDismiss={onDismissReviewItem}
                isLoading={item.id === preparingReviewItemId}
              />
            ))}
          </div>
        </section>
      ) : null}

      {patchDiagnostics ? (
        <details className="rail-disclosure">
          <summary className="mono-ui">Patch</summary>
          <div className="disclosure-body">
            <p className="editor-note-copy">Провайдер: {patchDiagnostics.requestedProvider} → {patchDiagnostics.requestedModelId}</p>
            <p className="editor-note-copy">Блоків: {patchDiagnostics.targetBlockCount}</p>
            <p className="editor-note-copy">Правок: {patchDiagnostics.returnedOperationCount}</p>
          </div>
        </details>
      ) : null}

      {reviewDiagnostics ? (
        <details className="rail-disclosure">
          <summary className="mono-ui">Review</summary>
          <div className="disclosure-body">
            <p className="editor-note-copy">Провайдер: {reviewDiagnostics.requestedProvider} → {reviewDiagnostics.requestedModelId}</p>
            <p className="editor-note-copy">Блоків: {reviewDiagnostics.blockCount}</p>
            <p className="editor-note-copy">Рекомендацій: {reviewDiagnostics.returnedItemCount}</p>
            {reviewDiagnostics.droppedItemCount > 0 ? (
              <p className="editor-note-copy">
                Відхилено під час нормалізації/фільтрації: {reviewDiagnostics.droppedItemCount}
              </p>
            ) : null}
            {filteredTypeSummary ? (
              <p className="editor-note-copy">
                Відфільтровано за типом: {filteredTypeSummary}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}

      {history.length > 0 ? (
        <details className="rail-disclosure">
          <summary className="mono-ui">Історія</summary>
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
