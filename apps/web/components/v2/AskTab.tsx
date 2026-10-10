"use client";

import { useMemo, useState, type RefObject } from "react";
import type { EditorDocument } from "../../lib/editor/document-model";
import type { V2Copy } from "../../lib/v2/copy";
import { FRAGMENT_QUICK_ACTIONS, shortenQuote, type FragmentScope } from "../../lib/v2/fragment-actions";
import {
  normalizeInstruction,
  selectReviewBusy,
  selectRunningRunId,
  selectRunState,
  type V2RequestEntry,
  type V2RunId
} from "../../lib/v2/store";
import { createBlocksWhereLabel } from "../../lib/v2/where-label";
import { V2Icon } from "./icons";
import type { ReviewEngine } from "./useReviewEngine";
import styles from "./v2.module.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

interface AskTabProps {
  copy: V2Copy;
  review: ReviewEngine;
  document: EditorDocument | null;
  /** AI actions are off (the draft cannot be saved). */
  disabled: boolean;
  /** The fragment the request is about, or null for the whole chapter. */
  scope: FragmentScope | null;
  onClearScope: () => void;
  draft: string;
  onDraftChange: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onOpenEdits: () => void;
}

function formatTime(value: string, dateLocale: string): string {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

/**
 * `Запит`: the editor's own instruction, for the whole chapter or for the selected fragment. The answer is
 * never text pasted into the manuscript: it arrives as suggestions in the `Правки` queue.
 */
export function AskTab({ copy, review, document, disabled, scope, onClearScope, draft, onDraftChange, inputRef, onOpenEdits }: AskTabProps) {
  const text = copy.ask;
  const { state } = review;
  const { request } = state;
  const [invalid, setInvalid] = useState(false);
  const where = useMemo(() => createBlocksWhereLabel(document, copy.edits), [copy.edits, document]);
  const passNames = useMemo(() => new Map<string, string>(copy.edits.passList.map((pass) => [pass.id, pass.name])), [copy.edits.passList]);
  const run = selectRunState(state, "request");
  const running = run.status === "running";
  const runningId = selectRunningRunId(state);
  const busy = selectReviewBusy(state);
  const fragmentBusy = request.fragment !== null;

  const runName = (runId: V2RunId) =>
    runId === "diagnostics" || runId === "fact_check" || runId === "request" ? copy.overview.runNames[runId] : passNames.get(runId) ?? runId;
  // A chapter request needs the review endpoint; a fragment request does not.
  const chapterBlocked = !scope && busy && !running ? (runningId ? copy.overview.busyRun(runName(runningId)) : copy.overview.busyQueue) : null;
  const sendDisabled = disabled || (scope ? fragmentBusy : busy);

  const send = () => {
    if (sendDisabled) {
      return;
    }

    if (!normalizeInstruction(draft)) {
      // Nothing is sent without an instruction; the field says so.
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }

    const sent = scope ? review.runFragmentAction("custom", scope, draft) : review.runChapterRequest(draft);

    if (sent) {
      setInvalid(false);
      onDraftChange("");
    }
  };

  const progress = run.progress;
  const runLabel = !state.activeRun
    ? text.starting
    : request.retryIndex !== null
      ? text.retrying
      : progress?.phase === "generating"
        ? progress.total > 0
          ? text.generating(progress.completed, progress.total)
          : text.generatingPlain
        : text.planning;

  const renderOutcome = (entry: V2RequestEntry) => {
    const { outcome } = entry;

    switch (outcome.kind) {
      case "running":
        return (
          <span className={styles.askMuted}>
            <span className={styles.spin} /> {text.outcomeRunning}
          </span>
        );
      case "done":
        return (
          <span className={outcome.count > 0 ? styles.askRes : styles.askMuted}>
            {text.outcomeDone(outcome.count)}
            {outcome.holes ? ` · ${text.outcomeHoles(outcome.holes)}` : ""}
            {outcome.warnings?.length ? (
              <span className={styles.askErr}>
                {` · ${text.outcomeWarnings(outcome.warnings.length)}: ${outcome.warnings.join(" · ")}`}
              </span>
            ) : null}
          </span>
        );
      case "error":
        return <span className={styles.askErr}>{outcome.message}</span>;
      case "stopped":
        return <span className={styles.askMuted}>{text.outcomeStopped}</span>;
      case "question":
        return <span className={styles.askMuted}>{text.outcomeQuestion}</span>;
      case "interrupted":
        return <span className={styles.askMuted}>{text.outcomeInterrupted}</span>;
    }
  };

  return (
    <>
      <h2>{text.title}</h2>
      <p className={styles.lead}>{text.lead}</p>
      {scope ? (
        <div className={cx(styles.scope, styles.scopeFrag)} data-scope="fragment">
          <span>{text.scopeFragment(where(scope.blockIds))}</span>
          <button type="button" className={styles.tb} title={text.unscope} aria-label={text.unscope} onClick={onClearScope}>
            <V2Icon name="x" />
          </button>
          <q>{shortenQuote(scope.quote)}</q>
          <em>{text.scopeWhole}</em>
        </div>
      ) : (
        <div className={styles.scope} data-scope="chapter">
          <span>{text.scope}</span>
          <em>{text.scopeHint}</em>
        </div>
      )}
      <div className={styles.composer}>
        <textarea
          ref={inputRef}
          className={cx(styles.askq, invalid && styles.askqInvalid)}
          rows={4}
          value={draft}
          placeholder={scope ? text.placeholderFragment : text.placeholder}
          aria-label={text.title}
          aria-invalid={invalid}
          aria-describedby={invalid ? "v2-ask-error" : undefined}
          onChange={(event) => {
            onDraftChange(event.target.value);

            if (invalid && event.target.value.trim()) {
              setInvalid(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className={cx(styles.btn, styles.btnSolid)}
          disabled={sendDisabled}
          title={chapterBlocked ?? (scope && fragmentBusy ? text.fragmentBusy : undefined)}
          onClick={send}
        >
          {text.send}
        </button>
      </div>
      {invalid ? (
        <p className={styles.askError} id="v2-ask-error" role="alert">
          {text.empty}
        </p>
      ) : null}
      {chapterBlocked ? <p className={styles.hint}>{chapterBlocked}</p> : null}
      {running ? (
        <>
          <div className={styles.runline} data-request-run={progress?.phase ?? "starting"} role="status">
            <span>
              <span className={styles.spin} />
              {runLabel}
            </span>
            <button type="button" className={cx(styles.btn, styles.btnOutline, styles.btnSm)} onClick={() => review.stopRun()}>
              {text.stop}
            </button>
          </div>
          <p className={styles.hint}>{text.chapterRunningHint}</p>
        </>
      ) : null}
      {!running && run.status === "failed" && run.error ? (
        <p className={styles.runError} role="alert">
          <b>{text.failed}</b> {run.error}
        </p>
      ) : null}
      {request.fragment ? (
        <div className={styles.runline} data-fragment-run role="status">
          <span>
            <span className={styles.spin} />
            {text.fragmentRunning(request.fragment.label)}
          </span>
          <button type="button" className={cx(styles.btn, styles.btnOutline, styles.btnSm)} onClick={() => review.cancelFragment()}>
            {text.cancel}
          </button>
        </div>
      ) : null}
      {request.clarify ? (
        <div className={styles.clarify} data-clarify role="group" aria-label={text.clarifyTitle}>
          <b>{text.clarifyTitle}</b>
          <p>{text.clarifyText}</p>
          <div className={styles.row}>
            {request.clarify.choices.map((choice) => (
              <button
                key={choice}
                type="button"
                className={cx(styles.btn, styles.btnOutline, styles.btnSm)}
                disabled={disabled}
                onClick={() => review.answerClarify(choice)}
              >
                {text.clarifyChoices[choice]}
              </button>
            ))}
            <button type="button" className={cx(styles.btn, styles.btnGhost, styles.btnSm)} onClick={() => review.dismissClarify()}>
              {text.clarifyDismiss}
            </button>
          </div>
        </div>
      ) : null}
      {request.holes.length > 0 && !running ? (
        <>
          <h3 className={styles.sec}>{text.holesTitle}</h3>
          <p className={styles.hint}>{text.holesLead}</p>
          <ul className={styles.holes}>
            {request.holes.map((hole) => {
              const action = request.plan?.[hole.index];

              return (
                <li key={hole.index} data-hole={hole.index}>
                  <b>{action ? `${action.title} · ${where([action.blockId])}` : `#${hole.index + 1}`}</b>
                  <em>{hole.message}</em>
                  <button
                    type="button"
                    className={cx(styles.btn, styles.btnOutline, styles.btnSm)}
                    disabled={disabled || busy || !action || !request.planInstruction}
                    title={!action ? text.retryUnavailable : undefined}
                    onClick={() => review.retryRequestAction(hole.index)}
                  >
                    {text.holeRetry}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {scope ? (
        <>
          <h3 className={styles.sec}>{text.quickTitle}</h3>
          <div className={styles.quick}>
            {FRAGMENT_QUICK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                className={styles.chip}
                data-quick={action}
                disabled={disabled || fragmentBusy}
                onClick={() => review.runFragmentAction(action, scope)}
              >
                {text.quick[action]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <h3 className={styles.sec}>{text.examples}</h3>
          <div className={styles.quick}>
            {text.ideas.map((idea) => (
              <button
                key={idea}
                type="button"
                className={styles.chip}
                onClick={() => {
                  // An example only fills the field; sending is a separate, deliberate press.
                  onDraftChange(idea);
                  setInvalid(false);
                  inputRef.current?.focus();
                }}
              >
                {idea}
              </button>
            ))}
          </div>
        </>
      )}
      {request.history.length > 0 ? (
        <>
          <h3 className={styles.sec}>{text.history}</h3>
          <ul className={styles.asks}>
            {request.history.map((entry) => (
              <li key={entry.id} data-request={entry.id} data-request-outcome={entry.outcome.kind}>
                <b>{entry.text}</b>
                {entry.quote ? <q>{entry.quote}</q> : null}
                <small>{[entry.scope === "chapter" ? text.scope : text.scopeFragment(entry.where ?? ""), formatTime(entry.at, copy.dateLocale)].filter(Boolean).join(" · ")}</small>
                {renderOutcome(entry)}
                {entry.outcome.kind === "done" && entry.outcome.count > 0 ? (
                  <>
                    {" · "}
                    <button type="button" className={styles.link} onClick={onOpenEdits}>
                      {text.showQueue}
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
