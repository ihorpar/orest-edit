import type { PatchOperation } from "../../lib/editor/patch-contract";
import { Button } from "../ui/Button";

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
      <div className="editor-note-head operation-note-head">
        <div className="operation-note-copy">
          <p className="editor-note-title">{title}</p>
          {detail ? <p className="editor-note-copy">{detail}</p> : null}
        </div>
        <div className="operation-note-top-right">
          <div className="operation-note-meta">
            {context?.paragraphLabel ? <span className="err-compact-range">{context.paragraphLabel}</span> : null}
            <span className="mono-ui editor-note-badge">{operation.type}</span>
          </div>
          <div className="button-row operation-note-actions">
            <Button size="sm" variant="secondary" onClick={() => onReject(operation.id)}>
              Відхилити
            </Button>
            <Button size="sm" variant="primary" onClick={() => onAccept(operation.id)}>
              Прийняти
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
