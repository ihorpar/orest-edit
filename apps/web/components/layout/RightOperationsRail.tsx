import type { PatchResponseDiagnostics, PatchOperation } from "../../lib/editor/patch-contract";
import { OperationCard } from "../editor/OperationCard";
import { Button } from "../ui/Button";

export interface RequestHistoryItem {
  id: string;
  timestampLabel: string;
  providerUsed: string;
  requestedProvider: string;
  requestedModelId: string;
  mode: "default" | "custom";
  operationCount: number;
  droppedOperationCount: number;
  usedFallback: boolean;
  tone: "info" | "error";
  message: string;
}

export function RightOperationsRail({
  diagnostics,
  history,
  loading,
  onAccept,
  onAcceptAll,
  onReject,
  onRejectAll,
  operations,
  statusMessage,
  statusTone
}: {
  diagnostics: PatchResponseDiagnostics | null;
  history: RequestHistoryItem[];
  loading?: boolean;
  onAccept: (id: string) => void;
  onAcceptAll: () => void;
  onReject: (id: string) => void;
  onRejectAll: () => void;
  operations: PatchOperation[];
  statusMessage?: string;
  statusTone?: "info" | "error";
}) {
  return (
    <div className="rail-stack">
      {statusMessage ? (
        <p className="rail-status-copy" data-tone={statusTone ?? "info"}>
          {statusMessage}
        </p>
      ) : null}

      {loading || operations.length > 0 ? (
        <section className="rail-section">
          <div className="rail-section-head">
            <p className="mono-ui operations-title">Правки на розгляді</p>
            {operations.length > 0 ? (
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

          {loading ? <div className="operations-empty mono-ui">Готую локальні правки…</div> : null}

          <div className="operations-stack">
            {operations.map((operation) => (
              <OperationCard key={operation.id} operation={operation} onAccept={onAccept} onReject={onReject} />
            ))}
          </div>
        </section>
      ) : null}

      {diagnostics ? (
        <details className="rail-disclosure">
          <summary className="mono-ui">Діагностика</summary>
          <div className="disclosure-body">
            <div className="request-diagnostics-grid">
              <p className="editor-note-copy">
                <strong>Провайдер:</strong> {diagnostics.requestedProvider} → {diagnostics.requestedModelId}
              </p>
              <p className="editor-note-copy">
                <strong>Режим:</strong> {diagnostics.appliedMode === "custom" ? "кастомний" : "базовий"}
              </p>
              <p className="editor-note-copy">
                <strong>Виділення:</strong> {diagnostics.selectionLength} символів
              </p>
              <p className="editor-note-copy">
                <strong>Правок:</strong> {diagnostics.returnedOperationCount}
              </p>
              <p className="editor-note-copy">
                <strong>Відкинуто:</strong> {diagnostics.droppedOperationCount}
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
                  <span className="mono-ui request-history-badge">{entry.operationCount}</span>
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
