"use client";

import { useMemo, type ReactNode } from "react";
import type { EditorDocument } from "../../lib/editor/document-model";
import type { DiagnosticsMode } from "../../lib/editor/review-contract";
import type { V2Copy } from "../../lib/v2/copy";
import { formatAuthorQueriesText, hasAuthorQuery, type V2FactFinding } from "../../lib/v2/overview";
import { isOpenItem, selectReviewBusy, selectRunningRunId, selectRunState, type V2PassId, type V2RunId } from "../../lib/v2/store";
import { createBlocksWhereLabel } from "../../lib/v2/where-label";
import { LIVE_PASSES, PASS_ICON, PASS_TONE } from "./EditsTab";
import { V2Icon } from "./icons";
import { ReportMarkdown } from "./ReportMarkdown";
import type { ReviewEngine } from "./useReviewEngine";
import styles from "./v2.module.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

interface OverviewTabProps {
  copy: V2Copy;
  review: ReviewEngine;
  /** Manuscript as last saved; used for the "абз. N" references. */
  document: EditorDocument | null;
  /** Chapter title, for the heading of the copied author queries. */
  chapterTitle: string;
  /** AI actions are off (the draft cannot be saved). */
  disabled: boolean;
  onOpenEdits: () => void;
  onNotify: (tone: "info" | "error", message: string) => void;
}

function formatDate(value: string, dateLocale: string): string {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(date);
}

/**
 * `Огляд`: what the model sees in the chapter, without touching it. Diagnostics is the model's own report,
 * shown as written; the fact-check lists the claims it flagged, each with a way on: to the linked suggestion
 * in `Правки`, or into the list of questions for the author.
 */
export function OverviewTab({ copy, review, document, chapterTitle, disabled, onOpenEdits, onNotify }: OverviewTabProps) {
  const text = copy.overview;
  const { state } = review;
  const { overview } = state;
  const diagnostics = selectRunState(state, "diagnostics");
  const factCheck = selectRunState(state, "fact_check");
  const runningId = selectRunningRunId(state);
  const busy = selectReviewBusy(state);
  const where = useMemo(() => createBlocksWhereLabel(document, copy.edits), [copy.edits, document]);
  const passNames = useMemo(() => new Map<string, string>(copy.edits.passList.map((pass) => [pass.id, pass.name])), [copy.edits.passList]);

  const runName = (runId: V2RunId) =>
    runId === "diagnostics" || runId === "fact_check" || runId === "request" ? text.runNames[runId] : passNames.get(runId) ?? runId;
  /** Why a launcher cannot start right now, when another run holds the review endpoint. */
  const busyNote = (own: V2RunId) => {
    if (!busy || runningId === own) {
      return null;
    }

    return runningId ? text.busyRun(runName(runningId)) : text.busyQueue;
  };

  const modeSwitch = (
    <span className={styles.modeRow}>
      <span>{text.mode}</span>
      <span className={styles.seg} role="group" aria-label={text.mode}>
        {(["concise", "extended"] as DiagnosticsMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={overview.diagnosticsMode === mode ? styles.segOn : undefined}
            aria-pressed={overview.diagnosticsMode === mode}
            title={mode === "concise" ? text.modeConciseHint : text.modeExtendedHint}
            disabled={diagnostics.status === "running"}
            onClick={() => review.setDiagnosticsMode(mode)}
          >
            {mode === "concise" ? text.modeConcise : text.modeExtended}
          </button>
        ))}
      </span>
    </span>
  );

  const stopButton = (
    <button type="button" className={cx(styles.btn, styles.btnOutline, styles.btnSm)} onClick={() => review.stopRun()}>
      {text.stop}
    </button>
  );

  /* ---------- diagnostics ---------- */
  const diagnosticsBusyNote = busyNote("diagnostics");
  const diagnosticsRunning = diagnostics.status === "running";
  let diagnosticsBlock: ReactNode;

  if (diagnosticsRunning) {
    diagnosticsBlock = (
      <div className={styles.starter} data-overview="diagnostics" data-run-state="running">
        <div className={styles.starterMain}>
          <b>{text.diagnostics}</b>
          <p className={styles.busy} role="status">
            <span className={styles.spin} />
            {state.activeRun ? text.diagnosticsRunning : text.starting}
          </p>
        </div>
        {stopButton}
      </div>
    );
  } else if (!overview.diagnostics) {
    diagnosticsBlock = (
      <>
        <div className={styles.starter} data-overview="diagnostics" data-run-state={diagnostics.status}>
          <div className={styles.starterMain}>
            <b>{text.diagnostics}</b>
            <p>{text.diagnosticsText}</p>
          </div>
          <div className={styles.starterSide}>
            <button
              type="button"
              className={cx(styles.btn, styles.btnSolid)}
              disabled={disabled || Boolean(diagnosticsBusyNote)}
              title={diagnosticsBusyNote ?? undefined}
              onClick={() => review.runStep("diagnostics")}
            >
              {text.diagnosticsAction}
            </button>
            {modeSwitch}
          </div>
        </div>
      </>
    );
  } else {
    diagnosticsBlock = null;
  }

  const report = overview.diagnostics ? (
    <section data-overview="report">
      <h3 className={styles.sec}>
        {text.diagnostics}
        <span className={styles.secMeta}>
          {text.reportMeta(overview.diagnostics.mode === "extended" ? text.modeExtended : text.modeConcise, formatDate(overview.diagnostics.at, copy.dateLocale))}
        </span>
      </h3>
      <div className={styles.report}>
        <ReportMarkdown text={overview.diagnostics.text} tableClassName={styles.reportTable} />
      </div>
      {diagnosticsRunning ? null : (
        <div className={styles.reportBar}>
          {modeSwitch}
          <button
            type="button"
            className={styles.link}
            disabled={disabled || Boolean(diagnosticsBusyNote)}
            title={diagnosticsBusyNote ?? undefined}
            onClick={() => review.runStep("diagnostics")}
          >
            {text.rerun}
          </button>
        </div>
      )}
      <h3 className={styles.sec}>{text.shortcuts}</h3>
      <div className={styles.quick}>
        {copy.edits.passList
          .filter((pass) => LIVE_PASSES.has(pass.id))
          .map((pass) => {
            const passId: V2PassId = pass.id;
            const passBusy = passId === "spell" ? state.passes.spell?.status === "running" : busy;

            return (
              <button
                key={pass.id}
                type="button"
                className={cx(styles.chip, PASS_TONE[pass.id])}
                data-shortcut={pass.id}
                disabled={disabled || passBusy}
                title={passBusy && passId !== "spell" ? busyNote(passId) ?? undefined : text.shortcutTitle(pass.name)}
                onClick={() => {
                  // Exactly what the pass row does; the queue is where its result is read.
                  if (review.runPass(passId)) {
                    onOpenEdits();
                  }
                }}
              >
                <V2Icon name={PASS_ICON[pass.id]} />
                {pass.name}
              </button>
            );
          })}
      </div>
    </section>
  ) : null;

  /* ---------- fact-check ---------- */
  const factBusyNote = busyNote("fact_check");
  const factRunning = factCheck.status === "running";
  const findings = overview.factCheck?.findings ?? [];
  const itemsById = useMemo(() => new Map(state.items.map((item) => [item.id, item])), [state.items]);

  const renderFinding = (finding: V2FactFinding) => {
    const linked = finding.itemId ? itemsById.get(finding.itemId) : undefined;
    const queued = hasAuthorQuery(overview.authorQueries, finding);

    return (
      <article key={finding.id} className={styles.finding} data-finding={finding.id} data-finding-status={finding.status}>
        <div className={styles.findingMeta}>
          <span className={cx(styles.status, finding.status === "unsupported" && styles.statusHard)}>
            {finding.status === "unsupported" ? text.statusUnsupported : text.statusQuestionable}
          </span>
          {finding.blockId ? <span>{where([finding.blockId])}</span> : null}
        </div>
        <p className={styles.claim}>{finding.claim}</p>
        {finding.explanation ? <p>{finding.explanation}</p> : null}
        <div className={styles.sources}>
          {finding.sources.length > 0 ? (
            <>
              <span>{text.sources}:</span>
              {finding.sources.map((source) => (
                <a key={source.url} className={styles.chip} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
                  {source.domain || source.title}
                </a>
              ))}
            </>
          ) : (
            <span>{text.noSource}</span>
          )}
        </div>
        <div className={styles.row}>
          {linked && isOpenItem(linked) ? (
            <button
              type="button"
              className={cx(styles.btn, styles.btnSoft)}
              onClick={() => {
                review.revealItem(linked.id);
                onOpenEdits();
              }}
            >
              {text.toEdit}
            </button>
          ) : linked ? (
            <span className={styles.note}>{text.toEditDecided}</span>
          ) : (
            <span className={styles.note}>{text.toEditMissing}</span>
          )}
          {queued ? (
            <span className={cx(styles.note, styles.noteOk)}>
              <V2Icon name="check" />
              {text.askAuthorAdded}
            </span>
          ) : (
            <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={() => review.addAuthorQuery(finding.id)}>
              {text.askAuthor}
            </button>
          )}
        </div>
      </article>
    );
  };

  let factBlock: ReactNode;

  if (factRunning) {
    factBlock = (
      <div className={styles.starter} data-overview="fact" data-run-state="running">
        <div className={styles.starterMain}>
          <b>{text.factCheck}</b>
          <p className={styles.busy} role="status">
            <span className={styles.spin} />
            {state.activeRun ? text.factRunning : text.starting}
          </p>
        </div>
        {stopButton}
      </div>
    );
  } else if (!overview.factCheck) {
    factBlock = (
      <>
        <div className={styles.starter} data-overview="fact" data-run-state={factCheck.status}>
          <div className={styles.starterMain}>
            <b>{text.factCheck}</b>
            <p>{text.factCheckText}</p>
          </div>
          <button
            type="button"
            className={cx(styles.btn, styles.btnOutline)}
            disabled={disabled || Boolean(factBusyNote)}
            title={factBusyNote ?? undefined}
            onClick={() => review.runStep("fact_check")}
          >
            {text.factCheckAction}
          </button>
        </div>
      </>
    );
  } else {
    factBlock = null;
  }

  const factReport = overview.factCheck ? (
    <section data-overview="fact-report">
      <h3 className={styles.sec}>
        {text.factCheck}
        <span className={styles.secMeta}>
          {[findings.length > 0 ? text.factCount(findings.length) : null, formatDate(overview.factCheck.at, copy.dateLocale)].filter(Boolean).join(" · ")}
        </span>
      </h3>
      {findings.length > 0 ? (
        <div className={styles.findings}>{findings.map(renderFinding)}</div>
      ) : (
        <div className={styles.empty} data-fact-empty>
          <b>{text.factNoneTitle}</b>
          {text.factNoneText(overview.factCheck.checkedCount)}
        </div>
      )}
      {factRunning ? null : (
        <div className={styles.reportBar}>
          <span />
          <button
            type="button"
            className={styles.link}
            disabled={disabled || Boolean(factBusyNote)}
            title={factBusyNote ?? undefined}
            onClick={() => review.runStep("fact_check")}
          >
            {text.factRerun}
          </button>
        </div>
      )}
    </section>
  ) : null;

  /* ---------- questions for the author ---------- */
  const copyQueries = async () => {
    const plain = formatAuthorQueriesText(overview.authorQueries, {
      chapterTitle,
      where: (query) => (query.blockId && document?.blocks.some((block) => block.id === query.blockId) ? where([query.blockId]) : null),
      copy: text.copyText
    });

    try {
      await navigator.clipboard.writeText(plain);
      onNotify("info", text.copied);
    } catch (error) {
      onNotify("error", error instanceof Error && error.message ? `${text.copyFailed} ${error.message}` : text.copyFailed);
    }
  };

  const authors =
    overview.authorQueries.length > 0 ? (
      <section data-overview="authors">
        <h3 className={styles.sec}>
          {text.authorTitle}
          <button type="button" className={styles.link} onClick={() => void copyQueries()}>
            {text.copyAll}
          </button>
        </h3>
        <ul className={styles.authors}>
          {overview.authorQueries.map((query) => (
            <li key={query.id} data-author-query={query.id}>
              <span className={styles.claim}>{query.claim}</span>
              {query.blockId && document?.blocks.some((block) => block.id === query.blockId) ? (
                <span className={styles.note}>{where([query.blockId])}</span>
              ) : null}
              <div className={styles.authorRow}>
                <input
                  type="text"
                  value={query.note}
                  placeholder={text.authorNotePlaceholder}
                  aria-label={text.authorNoteLabel}
                  onChange={(event) => review.setAuthorQueryNote(query.id, event.target.value)}
                />
                <button type="button" className={cx(styles.btn, styles.btnGhost, styles.btnSm)} onClick={() => review.removeAuthorQuery(query.id)}>
                  {text.authorRemove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  const runNote = (failed: string, stopped: string, run: typeof diagnostics) =>
    run.status === "failed" && run.error ? (
      <p className={styles.runError} role="alert">
        <b>{failed}</b> {run.error}
      </p>
    ) : run.status === "idle" && run.stopped ? (
      <p className={styles.hint} role="status">
        {stopped}
      </p>
    ) : null;

  return (
    <>
      <h2>{text.title}</h2>
      {diagnosticsBlock}
      {runNote(text.diagnosticsFailed, text.diagnosticsStopped, diagnostics)}
      {report}
      {factBlock}
      {runNote(text.factFailed, text.factStopped, factCheck)}
      {factReport}
      {authors}
    </>
  );
}
