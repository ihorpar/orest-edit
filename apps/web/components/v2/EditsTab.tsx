"use client";

import { useMemo, useRef, type KeyboardEvent } from "react";
import type { EditorDocument } from "../../lib/editor/document-model";
import type { EditorialReviewItem } from "../../lib/editor/review-contract";
import type { V2Copy, V2PassRowId } from "../../lib/v2/copy";
import {
  canApplyProposal,
  getItemPassId,
  selectPassOpenCount,
  selectPassState,
  selectQueue,
  selectRunningPassId,
  selectSummary,
  type V2PassId
} from "../../lib/v2/store";
import type { ReviewDiffReport } from "../../lib/v2/review-marks";
import { V2Icon, type V2IconName } from "./icons";
import type { ReviewEngine } from "./useReviewEngine";
import styles from "./v2.module.css";

/** Passes wired to the backend so far. The rest stay visible and disabled. */
const LIVE_PASSES: ReadonlySet<V2PassRowId> = new Set<V2PassRowId>(["clarity"]);

const PASS_TONE: Record<V2PassRowId, string | undefined> = {
  structure: styles.tStructure,
  clarity: styles.tClarity,
  interest: styles.tInterest,
  visual: styles.tVisual,
  accent: styles.tAccent,
  spell: styles.tSpell
};

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

interface EditsTabProps {
  copy: V2Copy;
  review: ReviewEngine;
  /** Which prepared changes the manuscript actually shows; only those can be accepted. */
  diffReport: ReviewDiffReport;
  /** Manuscript as last saved; used for the "абз. N" labels. */
  document: EditorDocument | null;
  /** AI actions are off (the draft cannot be saved). */
  disabled: boolean;
}

export function EditsTab({ copy, review, diffReport, document, disabled }: EditsTabProps) {
  const { state } = review;
  const text = copy.edits;
  const drawn = useRef(new Set<string>());
  const queue = selectQueue(state);
  const summary = selectSummary(state);
  const runningPassId = selectRunningPassId(state);
  const passNames = useMemo(() => new Map<string, string>(text.passList.map((pass) => [pass.id, pass.name])), [text.passList]);
  const where = useMemo(() => createWhereLabel(document, text), [document, text]);

  const filterName = state.filter === "all" ? null : passNames.get(state.filter) ?? state.filter;
  const anyPassRan = Object.values(state.passes).some((pass) => pass?.status === "done");
  const anyPassFailed = Object.values(state.passes).some((pass) => pass?.status === "failed");

  let list;

  if (queue.length > 0) {
    list = (
      <div className={styles.queue}>
        {queue.map((item) => {
          const fresh = !drawn.current.has(item.id);
          drawn.current.add(item.id);

          return (
            <ReviewCard
              key={item.id}
              copy={copy}
              review={review}
              item={item}
              drawn={diffReport.drawn.includes(item.id)}
              drawFailure={diffReport.failed.find((entry) => entry.itemId === item.id)?.reason ?? null}
              where={where(item)}
              passName={passNames.get(getItemPassId(item) ?? "") ?? ""}
              fresh={fresh}
              disabled={disabled}
            />
          );
        })}
      </div>
    );
  } else if (runningPassId) {
    list = (
      <div className={styles.empty}>
        <b>{text.waitingTitle}</b>
        {text.waitingText}
      </div>
    );
  } else if (state.filter !== "all") {
    list = (
      <div className={styles.empty}>
        <b>{text.filterDoneTitle}</b>
        {text.filterDoneText}
      </div>
    );
  } else if (anyPassFailed) {
    // The failure is shown on the pass row; an empty queue here does not mean the work is done.
    list = (
      <div className={styles.empty}>
        <b>{text.emptyTitle}</b>
        {text.emptyText}
      </div>
    );
  } else if (summary.decided > 0) {
    list = (
      <div className={styles.empty}>
        <b>{text.allDecidedTitle}</b>
        {text.allDecidedText}
      </div>
    );
  } else if (anyPassRan) {
    list = (
      <div className={styles.empty}>
        <b>{text.noneFoundTitle}</b>
        {text.noneFoundText}
      </div>
    );
  } else {
    list = (
      <div className={styles.empty}>
        <b>{text.emptyTitle}</b>
        {text.emptyText}
      </div>
    );
  }

  return (
    <>
      {summary.hasAny ? (
        <div className={styles.summary}>
          <p>
            <b>{summary.open}</b> {text.summaryOpen(summary.open)}
            <span>{text.summaryDecided(summary.decided)}</span>
          </p>
          <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={summary.open + summary.decided} aria-valuenow={summary.decided}>
            <i style={{ width: `${(summary.decided / (summary.open + summary.decided || 1)) * 100}%` }} />
          </div>
        </div>
      ) : null}
      <h3 className={styles.sec}>{text.passes}</h3>
      <ul className={styles.passes}>
        {text.passList.map((pass) => (
          <PassRow
            key={pass.id}
            copy={copy}
            review={review}
            pass={pass}
            live={LIVE_PASSES.has(pass.id)}
            disabled={disabled}
            otherRunning={runningPassId !== null && runningPassId !== pass.id}
          />
        ))}
      </ul>
      <p className={styles.pending}>{text.liveNote}</p>
      <h3 className={styles.sec}>{text.queue}</h3>
      {filterName ? (
        <div className={styles.filterbar}>
          <span>
            {text.filterOnly(filterName)} ·{" "}
            <button type="button" className={styles.link} onClick={() => review.setFilter("all")}>
              {text.showAll}
            </button>
          </span>
        </div>
      ) : null}
      {list}
    </>
  );
}

function PassRow({
  copy,
  review,
  pass,
  live,
  disabled,
  otherRunning
}: {
  copy: V2Copy;
  review: ReviewEngine;
  pass: V2Copy["edits"]["passList"][number];
  live: boolean;
  disabled: boolean;
  otherRunning: boolean;
}) {
  const text = copy.edits;
  const passId: V2PassId = pass.id;
  const passState = selectPassState(review.state, passId);
  const open = selectPassOpenCount(review.state, passId);
  const isFilter = review.state.filter === passId;
  const canFilter = live && passState.status !== "running" && (open > 0 || isFilter);
  const launchDisabled = disabled || otherRunning;

  let right;

  if (!live) {
    right = (
      <button type="button" className={cx(styles.btn, styles.btnOutline, styles.btnSm)} disabled title={text.notLive}>
        {text.run}
      </button>
    );
  } else if (passState.status === "running") {
    right = (
      <span className={styles.passActions}>
        <span className={styles.state} role="status">
          <span className={styles.spin} />
          {passState.progress
            ? text.readingProgress(passState.progress.completed, passState.progress.total)
            : review.state.activeRun
              ? text.reading
              : text.starting}
        </span>
        <button
          type="button"
          className={cx(styles.btn, styles.btnOutline, styles.btnSm)}
          onClick={(event) => {
            event.stopPropagation();
            review.stopRun();
          }}
        >
          {text.stop}
        </button>
      </span>
    );
  } else if (passState.status === "idle" && !passState.stopped && open === 0) {
    right = (
      <button
        type="button"
        className={cx(styles.btn, styles.btnOutline, styles.btnSm)}
        disabled={launchDisabled}
        title={otherRunning ? text.anotherRun : undefined}
        onClick={(event) => {
          event.stopPropagation();
          review.runPass(passId);
        }}
      >
        {text.run}
      </button>
    );
  } else {
    right = (
      <span className={styles.passActions}>
        {open > 0 ? (
          <span className={styles.n} title={text.openCountTitle}>
            {open}
          </span>
        ) : passState.status === "failed" ? (
          <span className={cx(styles.state, styles.stateBad)}>{text.failed}</span>
        ) : passState.stopped ? (
          <span className={styles.state}>{text.stopped}</span>
        ) : (
          <span className={cx(styles.state, styles.stateOk)}>
            <V2Icon name="check" />
            {text.done}
          </span>
        )}
        <button
          type="button"
          className={cx(styles.btn, styles.btnGhost, styles.btnSm)}
          disabled={launchDisabled}
          title={otherRunning ? text.anotherRun : text.rerunTitle}
          onClick={(event) => {
            event.stopPropagation();
            review.runPass(passId);
          }}
        >
          {text.rerun}
        </button>
      </span>
    );
  }

  return (
    <li
      className={cx(styles.pass, PASS_TONE[pass.id], canFilter && styles.passRan, isFilter && styles.passOn)}
      onClick={canFilter ? () => review.setFilter(isFilter ? "all" : passId) : undefined}
    >
      <i className={styles.ico}>
        <V2Icon name={pass.id as V2IconName} />
      </i>
      <span>
        <b>{pass.name}</b>
        <em>{pass.text}</em>
      </span>
      {right}
      {live && passState.status === "failed" && passState.error ? (
        <p className={styles.passError} role="alert">
          <b>{text.runFailed}</b> {passState.error}
        </p>
      ) : null}
      {live && passState.status === "idle" && passState.stopped && open > 0 ? (
        <p className={styles.passNote}>{text.stopped}</p>
      ) : null}
      {live && passState.warnings?.length ? (
        <p className={styles.passError} role="alert">
          <b>{text.runWarnings(passState.warnings.length)}</b> {Array.from(new Set(passState.warnings)).join(" · ")}
        </p>
      ) : null}
    </li>
  );
}

function ReviewCard({
  copy,
  review,
  item,
  drawn,
  drawFailure,
  where,
  passName,
  fresh,
  disabled
}: {
  copy: V2Copy;
  review: ReviewEngine;
  item: EditorialReviewItem;
  /** The prepared change is visible in the manuscript right now. */
  drawn: boolean;
  /** Why the prepared change could not be shown, when it could not. */
  drawFailure: ReviewDiffReport["failed"][number]["reason"] | null;
  where: string;
  passName: string;
  fresh: boolean;
  disabled: boolean;
}) {
  const text = copy.edits;
  const { state } = review;
  const passId = getItemPassId(item);
  const proposal = state.proposals[item.id];
  const focused = state.focusId === item.id;
  const hot = state.hoverId === item.id;
  const instruction = state.instructions[item.id] ?? "";
  const hasInstruction = instruction.trim().length > 0;
  const preparing = proposal?.status === "preparing";
  const ready = proposal?.status === "ready" && item.status === "ready" ? proposal : null;
  const failed = proposal?.status === "failed" ? proposal : null;
  const stale = item.status === "stale";
  const textDiff = ready?.proposal.textDiff;
  const noOp = textDiff?.warning?.code === "no_op" ? textDiff.warning : null;
  const stop = (handler: () => void) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    handler();
  };
  const regenerate = () => review.prepareItem(item.id, hasInstruction ? instruction.trim() : undefined);

  let main;

  if (preparing) {
    main = (
      <button type="button" className={cx(styles.btn, styles.btnSoft)} disabled>
        <span className={styles.spin} />
        {text.preparing}
      </button>
    );
  } else if (ready) {
    main = (
      <button
        type="button"
        className={cx(styles.btn, styles.btnSoft)}
        disabled={disabled || (focused && (!drawn || !canApplyProposal(state, item.id)))}
        title={focused ? (hasInstruction ? text.refinePending : !drawn ? text.acceptNeedsDiff : undefined) : undefined}
        onClick={stop(() => (focused ? review.acceptItem(item.id) : review.focusItem(item.id)))}
      >
        {focused ? text.accept : text.show}
      </button>
    );
  } else if (stale) {
    main = (
      <button type="button" className={cx(styles.btn, styles.btnSoft)} disabled={disabled} onClick={stop(() => {
        review.focusItem(item.id);
        review.prepareItem(item.id);
      })}>
        {text.prepareAgain}
      </button>
    );
  } else if (failed) {
    main = (
      <button type="button" className={cx(styles.btn, styles.btnSoft)} disabled={disabled} onClick={stop(() => {
        review.focusItem(item.id);
        regenerate();
      })}>
        {text.retry}
      </button>
    );
  } else {
    main = (
      <button type="button" className={cx(styles.btn, styles.btnSoft)} disabled={disabled} onClick={stop(() => review.showItem(item.id))}>
        {text.show}
      </button>
    );
  }

  return (
    <article
      className={cx(
        styles.card,
        passId && passId !== "formatting" ? PASS_TONE[passId] : undefined,
        focused && styles.isFocus,
        hot && styles.isHot,
        fresh && styles.cardNew
      )}
      data-card={item.id}
      data-card-state={preparing ? "preparing" : stale ? "stale" : ready ? "ready" : failed ? "failed" : "pending"}
      tabIndex={0}
      aria-current={focused ? "true" : undefined}
      onClick={() => review.focusItem(item.id)}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        // Enter on the card is an explicit request to see the change; a plain click only focuses it.
        if (event.key === "Enter" && event.target === event.currentTarget && !disabled) {
          event.preventDefault();
          review.showItem(item.id);
        }
      }}
      onMouseEnter={() => review.hoverItem(item.id)}
      onMouseLeave={() => review.hoverItem(null)}
    >
      <header>
        <span className={styles.ttag}>
          {passId && passId !== "formatting" ? <V2Icon name={passId as V2IconName} /> : null}
          {passName}
        </span>
        <span className={styles.where}>{where}</span>
      </header>
      <div className={styles.what}>{item.title}</div>
      <p className={styles.why}>{item.reason}</p>
      {focused ? (
        <p className={styles.how}>
          <b>{text.recommendation}</b>
          {item.recommendation}
        </p>
      ) : null}
      {focused && textDiff?.reason && textDiff.reason.trim() !== item.reason.trim() && textDiff.reason.trim() !== item.recommendation.trim() ? (
        <p className={styles.how}>
          <b>{text.changeReason}</b>
          {textDiff.reason}
        </p>
      ) : null}
      {preparing ? (
        <p className={styles.busy} role="status">
          <span className={styles.spin} />
          {text.preparing}
        </p>
      ) : null}
      {stale && !preparing ? <p className={styles.cardNote}>{failed?.message ?? text.stale}</p> : null}
      {failed && !stale ? (
        <p className={styles.cardError} role="alert">
          <b>{text.proposalFailed}</b> {failed.message}
        </p>
      ) : null}
      {ready && noOp ? (
        <p className={styles.cardNote} role="status">
          {ready.noOpStreak >= 2 ? text.noOpRepeat : noOp.message}
        </p>
      ) : null}
      {ready?.error ? (
        <p className={styles.cardError} role="alert">
          <b>{text.regenerateFailed}</b> {ready.error}
        </p>
      ) : null}
      {ready && focused && drawFailure === "mismatch" ? (
        <p className={styles.cardError} role="alert">
          {text.diffMismatch}
        </p>
      ) : null}
      {ready && focused && drawFailure === "empty" && !noOp ? <p className={styles.cardNote}>{text.diffEmpty}</p> : null}
      {focused && (ready || (failed && !stale)) ? (
        <div className={styles.refine} onClick={(event) => event.stopPropagation()}>
          <input
            type="text"
            className={styles.refineInput}
            value={instruction}
            placeholder={text.refinePlaceholder}
            aria-label={text.refineLabel}
            disabled={disabled}
            onChange={(event) => review.setInstruction(item.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !disabled) {
                event.preventDefault();
                regenerate();
              }
            }}
          />
          <button type="button" className={cx(styles.btn, hasInstruction ? styles.btnSolid : styles.btnOutline, styles.btnSm)} disabled={disabled} onClick={regenerate}>
            {hasInstruction ? text.regenerateWithRefine : text.regenerate}
          </button>
        </div>
      ) : null}
      {focused && ready && hasInstruction ? <p className={styles.cardNote}>{text.refinePending}</p> : null}
      <footer>
        <button type="button" className={cx(styles.btn, styles.btnGhost)} disabled={disabled} onClick={stop(() => review.rejectItem(item.id))}>
          {text.reject}
        </button>
        {main}
      </footer>
    </article>
  );
}

/** "абз. 3", "абз. 3–4", "заголовок": the paragraph numbers are the ones shown in the manuscript gutter. */
function createWhereLabel(document: EditorDocument | null, text: V2Copy["edits"]): (item: EditorialReviewItem) => string {
  const paragraphNumber = new Map<string, number>();
  const blockType = new Map<string, string>();
  let count = 0;

  for (const block of document?.blocks ?? []) {
    blockType.set(block.id, block.type);

    if (block.type === "paragraph") {
      count += 1;
      paragraphNumber.set(block.id, count);
    }
  }

  return (item) => {
    const ids = item.anchor.blockIds;

    if (ids.length === 0 || !ids.every((blockId) => blockType.has(blockId))) {
      return text.whereGone;
    }

    const numbers = ids.map((blockId) => paragraphNumber.get(blockId)).filter((value): value is number => value !== undefined);

    if (numbers.length === 0) {
      return blockType.get(ids[0]!) === "heading" ? text.whereHeading : text.whereBlock;
    }

    const first = Math.min(...numbers);
    const last = Math.max(...numbers);
    return text.whereParagraph(first === last ? String(first) : `${first}–${last}`);
  };
}
