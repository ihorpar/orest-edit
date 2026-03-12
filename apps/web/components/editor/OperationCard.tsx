import type { PatchOperation } from "../../lib/editor/patch-contract";
import { Button } from "../ui/Button";

export function OperationCard({
  operation,
  onAccept,
  onReject
}: {
  operation: PatchOperation;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <article className="editor-note-card">
      <div className="editor-note-head">
        <p className="editor-note-title">{operation.reason}</p>
        <span className="mono-ui editor-note-badge">{operation.type}</span>
      </div>
      <div className="button-row">
        <Button size="sm" variant="secondary" onClick={() => onReject(operation.id)}>
          Відхилити
        </Button>
        <Button size="sm" variant="primary" onClick={() => onAccept(operation.id)}>
          Прийняти
        </Button>
      </div>
    </article>
  );
}
