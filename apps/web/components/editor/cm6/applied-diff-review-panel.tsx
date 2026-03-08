"use client";

import { DiffInlineMark } from "../DiffInlineMark";
import type { AppliedDiffMarker } from "../../../lib/editor/applied-diff";
import { findParagraphForOffset, formatParagraphLabel, type ManuscriptRevisionState } from "../../../lib/editor/manuscript-structure";

export function AppliedDiffReviewPanel({
  appliedDiffs,
  revision,
  text,
  onAppliedDiffChange,
  onDiscardAppliedDiffs,
  onDismissAppliedDiffs
}: {
  appliedDiffs: AppliedDiffMarker[];
  revision: ManuscriptRevisionState;
  text: string;
  onAppliedDiffChange: (id: string, newText: string) => void;
  onDiscardAppliedDiffs: () => void;
  onDismissAppliedDiffs: () => void;
}) {
  return (
    <section className="cm-orest-diff-review-panel">
      <div className="cm-orest-diff-review-head">
        <div>
          <p className="mono-ui cm-orest-diff-review-kicker">Щойно застосовано</p>
          <h3 className="cm-orest-diff-review-title">{appliedDiffs.length} diff до рукопису</h3>
        </div>
        <div className="cm-orest-diff-review-actions">
          <button type="button" className="manuscript-review-secondary" onClick={onDiscardAppliedDiffs}>
            Скасувати
          </button>
          <button type="button" className="manuscript-review-toggle" onClick={onDismissAppliedDiffs}>
            Готово
          </button>
        </div>
      </div>

      <div className="cm-orest-diff-review-list">
        {appliedDiffs.map((diff) => {
          const paragraphNumber = findParagraphForOffset(text, diff.start, revision);

          return (
            <article key={diff.id} className="cm-orest-diff-review-card">
              <div className="cm-orest-diff-review-meta">
                <span className="mono-ui cm-orest-diff-review-label">
                  {paragraphNumber ? `Абзац ${formatParagraphLabel(paragraphNumber)}` : "Локальна правка"}
                </span>
                <span className="cm-orest-diff-review-reason">{diff.reason}</span>
              </div>
              <DiffInlineMark
                oldText={diff.oldText}
                newText={diff.newText}
                variant="canvas"
                editableNewText={typeof diff.newText === "string"}
                onNewTextChange={(value) => onAppliedDiffChange(diff.id, value)}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
