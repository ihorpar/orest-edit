import type { PatchOperation } from "../../lib/editor/patch-contract";
import { DiffInlineMark } from "./DiffInlineMark";
import { Button } from "../ui/Button";

const typeLabels: Record<PatchOperation["type"], string> = {
  clarity: "ясність",
  structure: "структура",
  terminology: "терміни",
  source: "джерело",
  tone: "тон"
};

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
    <div className="suggestion-card">
      <div className="suggestion-card-top">
        <span className="mono-ui suggestion-card-type">{typeLabels[operation.type]}</span>
        <span className="mono-ui suggestion-card-lines">Символи {operation.start}-{operation.end}</span>
      </div>
      <div className="suggestion-card-diff">
        <DiffInlineMark oldText={operation.oldText} newText={operation.newText} />
      </div>
      <p className="suggestion-card-reason">"{operation.reason}"</p>
      <div className="button-row" style={{ marginTop: 14 }}>
        <Button variant="secondary" size="sm" onClick={() => onReject(operation.id)}>
          Відхилити
        </Button>
        <Button variant="primary" size="sm" onClick={() => onAccept(operation.id)}>
          Прийняти
        </Button>
      </div>
    </div>
  );
}
