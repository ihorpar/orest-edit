import type { PatchOperation } from "../../lib/editor/patch-contract";

export interface OperationCardContext {
  recommendation: string;
  reason?: string;
  paragraphLabel?: string;
}

export function OperationCard({
  operation,
  context,
  onAccept,
  onReject
}: {
  operation: PatchOperation;
  context?: OperationCardContext;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const title = context?.recommendation?.trim() ? context.recommendation.trim() : operation.reason;
  const detail =
    context?.reason && context.reason.trim() && context.reason.trim() !== title
      ? context.reason.trim()
      : null;

  return (
    <article className="editor-note-card operation-note-card">
      <div className="operation-note-copy">
        <div className="editor-note-head operation-note-head">
          <p className="editor-note-title">{title}</p>
          <div className="operation-note-meta-stack">
            <div className="operation-note-meta">
              {context?.paragraphLabel ? <span className="err-compact-range">{context.paragraphLabel}</span> : null}
              <span className="mono-ui editor-note-badge">{operation.type}</span>
            </div>
            <div className="operation-note-actions" role="group" aria-label="Дії правки">
              <button
                type="button"
                className="operation-note-action operation-note-action-reject"
                aria-label="Відхилити правку"
                title="Відхилити"
                onClick={() => onReject(operation.id)}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true" width="12" height="12">
                  <path d="M2 2l8 8M10 2L2 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                className="operation-note-action operation-note-action-accept"
                aria-label="Прийняти правку"
                title="Прийняти"
                onClick={() => onAccept(operation.id)}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true" width="12" height="12">
                  <path d="M2 6.5l2.3 2.3L10 3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {detail ? <p className="editor-note-copy operation-note-detail">{detail}</p> : null}
      </div>
    </article>
  );
}
