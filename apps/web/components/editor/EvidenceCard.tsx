import type { EvidenceState, SourceVM } from "../../lib/editor/view-model";

const stateLabel: Record<EvidenceState, string> = {
  verified: "\u0414\u0436\u0435\u0440\u0435\u043b\u043e \u0437\u043d\u0430\u0439\u0434\u0435\u043d\u043e",
  required: "\u041f\u043e\u0442\u0440\u0456\u0431\u043d\u0435 \u0434\u0436\u0435\u0440\u0435\u043b\u043e",
  insufficient_evidence: "\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043d\u044c\u043e \u0434\u0430\u043d\u0438\u0445"
};

export function EvidenceCard({ state, sources }: { state: EvidenceState; sources?: SourceVM[] }) {
  const title = sources?.[0]?.title ?? "\u041d\u0435\u043c\u0430\u0454 \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043e\u0433\u043e \u0434\u0436\u0435\u0440\u0435\u043b\u0430.";

  return (
    <div className="evidence-card">
      <div className="evidence-head">
        <span className="model-status-dot" aria-hidden="true" style={{ width: 6, height: 6, boxShadow: "none" }} />
        <span className="mono-ui evidence-title">{stateLabel[state]}</span>
      </div>
      <p className="evidence-copy">
        {"[1] \u041f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043d\u044f \u0437\u043d\u0430\u0439\u0434\u0435\u043d\u043e \u0432:"}
        <br />
        <em>{title}</em>
      </p>
      <div className="evidence-footer">
        <span className="mono-ui">{"\u041f\u0435\u0440\u0435\u0433\u043b\u044f\u043d\u0443\u0442\u0438"}</span>
      </div>
    </div>
  );
}
