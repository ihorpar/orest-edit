import type { OperationVM } from "../../lib/editor/view-model";
import { Card } from "../ui/Card";

export function FactCheckResults({ operations }: { operations: OperationVM[] }) {
  return (
    <Card>
      <p className="section-label" style={{ marginBottom: 8 }}>
        Fact-check snapshot
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
        Перевірено {operations.filter((item) => item.evidenceState === "verified").length} тверджень, потребують джерела {" "}
        {operations.filter((item) => item.evidenceState === "required").length}.
      </p>
    </Card>
  );
}
