"use client";

import { useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { EditorDocument } from "../../lib/editor/document-model";
import {
  getEditorialCalloutDepthOptions,
  getEditorialCalloutKindOptions,
  getEditorialCalloutKindTitle,
  type EditorialCalloutDepth,
  type EditorialCalloutKind
} from "../../lib/editor/review-contract";
import type { AppLocale } from "../../lib/i18n/product-locale";
import type { V2Copy, V2PassRowId } from "../../lib/v2/copy";
import {
  getAccentPhrase,
  getCalloutOptions,
  getHeadingDraft,
  getItemKind,
  getSpellReplacement,
  hasCalloutDraft,
  type V2ReviewItem
} from "../../lib/v2/item-kinds";
import {
  canAcceptItem,
  canApplyProposal,
  getItemPassId,
  planRunAll,
  selectBulkCandidates,
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

/** Passes wired to the backend. `Ілюстрації` stays visible and disabled until its milestone. */
export const LIVE_PASSES: ReadonlySet<V2PassRowId> = new Set<V2PassRowId>([
  "structure",
  "clarity",
  "interest",
  "formatting",
  "accent",
  "spell"
]);

const PASS_TONE: Record<V2PassRowId, string | undefined> = {
  structure: styles.tStructure,
  clarity: styles.tClarity,
  interest: styles.tInterest,
  formatting: styles.tFormatting,
  visual: styles.tVisual,
  accent: styles.tAccent,
  spell: styles.tSpell
};

const PASS_ICON: Record<V2PassRowId, V2IconName> = {
  structure: "structure",
  clarity: "clarity",
  interest: "interest",
  formatting: "list",
  visual: "visual",
  accent: "accent",
  spell: "spell"
};

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

interface EditsTabProps {
  copy: V2Copy;
  locale: AppLocale;
  review: ReviewEngine;
  /** Which results the manuscript actually shows; only those can be accepted. */
  diffReport: ReviewDiffReport;
  /** Manuscript as last saved; used for the "абз. N" labels. */
  document: EditorDocument | null;
  /** AI actions are off (the draft cannot be saved). */
  disabled: boolean;
}

export function EditsTab({ copy, locale, review, diffReport, document, disabled }: EditsTabProps) {
  const { state } = review;
  const text = copy.edits;
  const seen = useRef(new Set<string>());
  const queue = selectQueue(state);
  const summary = selectSummary(state);
  const runningPassId = selectRunningPassId(state);
  const spellRunning = selectPassState(state, "spell").status === "running";
  const passNames = useMemo(() => new Map<string, string>(text.passList.map((pass) => [pass.id, pass.name])), [text.passList]);
  const where = useMemo(() => createWhereLabel(document, text), [document, text]);
  const drawn = useMemo(() => new Set(diffReport.drawn), [diffReport.drawn]);

  const filterName = state.filter === "all" ? null : passNames.get(state.filter) ?? state.filter;
  const anyPassRan = Object.values(state.passes).some((pass) => pass?.status === "done");
  const anyPassFailed = Object.values(state.passes).some((pass) => pass?.status === "failed");
  const runAllPlan = planRunAll(state, LIVE_PASSES);
  const canRunAll = runAllPlan.queue.length > 0 || runAllPlan.spell;
  const bulk = selectBulkCandidates(state, diffReport.drawn);

  const renderCard = (item: V2ReviewItem, quiet = false) => {
    const fresh = !seen.current.has(item.id);
    seen.current.add(item.id);

    return (
      <ReviewCard
        key={item.id}
        copy={copy}
        locale={locale}
        review={review}
        item={item}
        drawn={drawn.has(item.id)}
        drawFailure={diffReport.failed.find((entry) => entry.itemId === item.id)?.reason ?? null}
        where={where(item)}
        passName={passNames.get(getItemPassId(item) ?? "") ?? ""}
        fresh={fresh}
        disabled={disabled}
        quiet={quiet}
      />
    );
  };

  let list;

  if (queue.length > 0 && state.quiet) {
    const current = queue.find((item) => item.id === state.focusId) ?? queue[0]!;
    const acceptable = canAcceptItem(state, current.id) && drawn.has(current.id);

    list = (
      <>
        {renderCard(current, true)}
        <p className={styles.keys}>
          <b>{text.quietPosition(queue.indexOf(current) + 1, queue.length)}</b>
          {acceptable || current.status !== "stale" ? (
            <span>
              <kbd>↵</kbd>
              {acceptable ? text.keyAccept : text.keyShow}
            </span>
          ) : null}
          <span>
            <kbd>⌫</kbd>
            {text.keyReject}
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd>
            {text.keyMove}
          </span>
        </p>
      </>
    );
  } else if (queue.length > 0) {
    list = <div className={styles.queue}>{queue.map((item) => renderCard(item))}</div>;
  } else if (runningPassId || spellRunning) {
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
      <h3 className={styles.sec}>
        {text.passes}
        {state.queue.length > 0 && state.queuePaused ? (
          <span className={styles.secActions}>
            <button type="button" className={styles.link} disabled={disabled} title={text.resumeQueueTitle} onClick={() => review.resumeQueue()}>
              {text.resumeQueue}
            </button>
            <button type="button" className={styles.link} onClick={() => review.clearQueue()}>
              {text.clearQueue}
            </button>
          </span>
        ) : state.queue.length > 0 ? (
          <button type="button" className={styles.link} onClick={() => review.stopAll()}>
            {text.stopAll}
          </button>
        ) : canRunAll ? (
          <button type="button" className={styles.link} disabled={disabled} title={text.runAllTitle} onClick={() => review.runAll()}>
            {text.runAll}
          </button>
        ) : null}
      </h3>
      <ul className={styles.passes}>
        {text.passList.map((pass) => (
          <PassRow
            key={pass.id}
            copy={copy}
            review={review}
            pass={pass}
            live={LIVE_PASSES.has(pass.id)}
            disabled={disabled}
            otherRunning={pass.id !== "spell" && runningPassId !== null && runningPassId !== pass.id}
          />
        ))}
      </ul>
      {state.queue.length > 0 && state.queuePaused ? (
        <p className={styles.pending} role="status">
          {text.queuePausedNote}
        </p>
      ) : null}
      <p className={styles.pending}>{text.liveNote}</p>
      <h3 className={styles.sec}>
        {text.queue}
        {summary.open > 0 || state.quiet ? (
          <button
            type="button"
            className={cx(styles.switch, state.quiet && styles.switchOn)}
            role="switch"
            aria-checked={state.quiet}
            title={text.quietTitle}
            disabled={disabled && !state.quiet}
            onClick={(event) => {
              // Keyboard focus must not stay here: Enter belongs to the current suggestion in quiet mode.
              event.currentTarget.blur();
              review.setQuiet(!state.quiet);
            }}
          >
            <i />
            {text.quiet}
          </button>
        ) : null}
      </h3>
      {state.quiet ? <p className={styles.quietNote}>{text.quietNote}</p> : null}
      {filterName ? (
        <div className={styles.filterbar}>
          <span>
            {text.filterOnly(filterName)} ·{" "}
            <button type="button" className={styles.link} onClick={() => review.setFilter("all")}>
              {text.showAll}
            </button>
          </span>
          {bulk.length > 1 ? (
            <button
              type="button"
              className={cx(styles.btn, styles.btnSoft, styles.btnSm)}
              disabled={disabled}
              title={text.bulkAcceptTitle}
              onClick={() => review.acceptAll()}
            >
              {text.bulkAccept(bulk.length)}
            </button>
          ) : null}
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
  const queued = review.state.queue.includes(passId);
  const canFilter = live && passState.status !== "running" && (open > 0 || isFilter);
  const launchDisabled = disabled || otherRunning;
  const stop = (handler: () => void) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    handler();
  };

  let right;

  if (!live) {
    right = (
      <span className={styles.state} title={text.notLive}>
        {text.soon}
      </span>
    );
  } else if (passState.status === "running") {
    right = (
      <span className={styles.passActions}>
        <span className={styles.state} role="status">
          <span className={styles.spin} />
          {passId === "spell"
            ? text.checking
            : passState.progress
              ? text.readingProgress(passState.progress.completed, passState.progress.total)
              : review.state.activeRun
                ? text.reading
                : text.starting}
        </span>
        <button type="button" className={cx(styles.btn, styles.btnOutline, styles.btnSm)} onClick={stop(() => review.stopPass(passId))}>
          {text.stop}
        </button>
      </span>
    );
  } else if (queued) {
    right = (
      <span className={styles.passActions}>
        <span className={styles.state} role="status">
          {review.state.queuePaused ? text.queuedPaused : text.queued}
        </span>
        <button
          type="button"
          className={cx(styles.btn, styles.btnGhost, styles.btnSm)}
          title={text.unqueueTitle}
          onClick={stop(() => review.stopPass(passId))}
        >
          {text.unqueue}
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
        onClick={stop(() => review.runPass(passId))}
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
          onClick={stop(() => review.runPass(passId))}
        >
          {text.rerun}
        </button>
      </span>
    );
  }

  return (
    <li
      className={cx(styles.pass, PASS_TONE[pass.id], !live && styles.passOff, canFilter && styles.passRan, isFilter && styles.passOn)}
      data-pass={pass.id}
      data-pass-state={!live ? "off" : passState.status === "running" ? "running" : queued ? (review.state.queuePaused ? "paused" : "queued") : passState.status}
      onClick={canFilter ? () => review.setFilter(isFilter ? "all" : passId) : undefined}
    >
      <i className={styles.ico}>
        <V2Icon name={PASS_ICON[pass.id]} />
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
  locale,
  review,
  item,
  drawn,
  drawFailure,
  where,
  passName,
  fresh,
  disabled,
  quiet
}: {
  copy: V2Copy;
  locale: AppLocale;
  review: ReviewEngine;
  item: V2ReviewItem;
  /** The result of this item is visible in the manuscript right now. */
  drawn: boolean;
  /** Why the prepared change could not be shown, when it could not. */
  drawFailure: ReviewDiffReport["failed"][number]["reason"] | null;
  where: string;
  passName: string;
  fresh: boolean;
  disabled: boolean;
  /** The single card of quiet mode: it carries the previous / next buttons. */
  quiet: boolean;
}) {
  const text = copy.edits;
  const { state } = review;
  const passId = getItemPassId(item);
  const kind = getItemKind(item);
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
  const acceptable = canAcceptItem(state, item.id);
  const stop = (handler: () => void) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    handler();
  };
  const regenerate = () => review.prepareItem(item.id, hasInstruction ? instruction.trim() : undefined);
  const soft = cx(styles.btn, styles.btnSoft);

  const headingDraft = kind === "heading" ? getHeadingDraft(item) : null;
  const calloutReady = kind === "callout" && hasCalloutDraft(item) && !stale;
  const calloutOptions = kind === "callout" ? getCalloutOptions(item) : null;
  const spell = item.spell;
  const replacement = getSpellReplacement(item);

  // A reason is shown on every card: the model's own, else what it recommends, else a line that says what
  // this kind of suggestion is for (accents arrive without a reason).
  const reason =
    item.reason.trim() ||
    item.recommendation.trim() ||
    (kind === "accent" ? text.reasonAccent : text.reasonMissing);
  const reasonIsRecommendation = !item.reason.trim() && item.recommendation.trim().length > 0;

  let what: ReactNode = item.title;

  if (kind === "heading") {
    what = headingDraft ? text.whatHeading(headingDraft.title) : item.subsectionDraft ? text.whatHeadingEmpty : item.title;
  } else if (kind === "accent") {
    what = getAccentPhrase(item) ? text.whatAccent(getAccentPhrase(item)) : item.title;
  } else if (kind === "callout" && calloutReady && item.calloutDraft) {
    const kindTitle = getEditorialCalloutKindTitle(item.calloutDraft.calloutKind, locale);
    what = text.whatCallout(kindTitle, item.calloutDraft.title?.trim() || kindTitle);
  } else if (spell) {
    what = replacement ? (
      <>
        {spell.badText} <span className={styles.to}>→</span> {replacement}
      </>
    ) : (
      spell.badText
    );
  }

  let main: ReactNode = null;

  if (preparing) {
    main = (
      <button type="button" className={soft} disabled>
        <span className={styles.spin} />
        {kind === "callout" ? text.preparingCallout : text.preparing}
      </button>
    );
  } else if (kind === "heading" || kind === "accent" || kind === "spell") {
    // Nothing to prepare: the result is in the text already, so accepting does not need the card focused.
    main = stale ? null : (
      <button
        type="button"
        className={soft}
        disabled={disabled || !acceptable || !drawn}
        title={acceptable && !drawn ? text.notDrawn : undefined}
        onClick={stop(() => review.acceptItem(item.id))}
      >
        {text.accept}
      </button>
    );
  } else if (kind === "visual") {
    main = (
      <button type="button" className={soft} disabled title={text.notLive}>
        {text.soon}
      </button>
    );
  } else if (calloutReady) {
    main = (
      <button
        type="button"
        className={soft}
        disabled={disabled || !acceptable || !drawn}
        title={hasInstruction ? text.refinePending : !drawn ? text.notDrawn : undefined}
        onClick={stop(() => review.acceptItem(item.id))}
      >
        {text.insert}
      </button>
    );
  } else if (ready) {
    main = (
      <button
        type="button"
        className={soft}
        disabled={disabled || (focused && (!drawn || !canApplyProposal(state, item.id)))}
        title={focused ? (hasInstruction ? text.refinePending : !drawn ? text.acceptNeedsDiff : undefined) : undefined}
        onClick={stop(() => (focused ? review.acceptItem(item.id) : review.focusItem(item.id)))}
      >
        {focused ? text.accept : text.show}
      </button>
    );
  } else if (stale) {
    main = (
      <button
        type="button"
        className={soft}
        disabled={disabled}
        onClick={stop(() => {
          review.focusItem(item.id);
          review.prepareItem(item.id);
        })}
      >
        {text.prepareAgain}
      </button>
    );
  } else if (failed) {
    main = (
      <button
        type="button"
        className={soft}
        disabled={disabled}
        onClick={stop(() => {
          review.focusItem(item.id);
          regenerate();
        })}
      >
        {text.retry}
      </button>
    );
  } else {
    main = (
      <button type="button" className={soft} disabled={disabled} onClick={stop(() => review.showItem(item.id))}>
        {kind === "callout" ? text.prepareCallout : text.show}
      </button>
    );
  }

  const staleNote =
    kind === "heading" ? text.headingGone : kind === "accent" ? text.accentStale : kind === "spell" ? text.spellStale : failed?.message ?? text.stale;
  const showRefine = focused && !stale && ((kind === "replace" && (ready || failed)) || (kind === "callout" && (calloutReady || failed)));

  return (
    <article
      className={cx(styles.card, passId ? PASS_TONE[passId] : undefined, focused && styles.isFocus, hot && styles.isHot, fresh && styles.cardNew)}
      data-card={item.id}
      data-card-kind={kind}
      data-card-state={preparing ? "preparing" : stale ? "stale" : item.status === "ready" ? "ready" : failed ? "failed" : "pending"}
      tabIndex={0}
      aria-current={focused ? "true" : undefined}
      onClick={() => review.focusItem(item.id)}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        // Enter on the card is an explicit request to see the change; a plain click only focuses it.
        // In quiet mode Enter is handled once, for the whole page.
        if (event.key === "Enter" && event.target === event.currentTarget && !disabled && !quiet) {
          event.preventDefault();
          review.showItem(item.id);
        }
      }}
      onMouseEnter={() => review.hoverItem(item.id)}
      onMouseLeave={() => review.hoverItem(null)}
    >
      <header>
        <span className={styles.ttag}>
          {passId ? <V2Icon name={PASS_ICON[passId]} /> : null}
          {passName}
        </span>
        <span className={styles.where}>{where}</span>
      </header>
      <div className={styles.what}>{what}</div>
      <p className={styles.why}>{reason}</p>
      {focused && item.recommendation.trim() && !reasonIsRecommendation && kind !== "accent" && kind !== "heading" ? (
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
      {focused && kind === "heading" && !stale ? (
        <div className={styles.options} onClick={(event) => event.stopPropagation()}>
          <span>{text.headingLevel}</span>
          <span className={styles.seg} role="group" aria-label={text.headingLevel}>
            {([2, 3] as const).map((level) => (
              <button
                key={level}
                type="button"
                className={(headingDraft?.headingLevel ?? item.subsectionDraft?.headingLevel ?? 3) === level ? styles.segOn : undefined}
                aria-pressed={(headingDraft?.headingLevel ?? item.subsectionDraft?.headingLevel ?? 3) === level}
                disabled={disabled}
                onClick={() => review.editHeading(item.id, { headingLevel: level })}
              >
                H{level}
              </button>
            ))}
          </span>
        </div>
      ) : null}
      {kind === "heading" && !stale && !headingDraft && item.subsectionDraft ? <p className={styles.cardNote}>{text.headingEmpty}</p> : null}
      {focused && calloutOptions && !stale ? (
        <div className={styles.options} onClick={(event) => event.stopPropagation()}>
          <label>
            <span>{text.calloutKind}</span>
            <select
              value={calloutOptions.calloutKind}
              disabled={disabled || preparing}
              onChange={(event) => review.setCalloutOptions(item.id, { calloutKind: event.target.value as EditorialCalloutKind })}
            >
              {getEditorialCalloutKindOptions(locale).map((option) => (
                <option key={option.value} value={option.value}>
                  {getEditorialCalloutKindTitle(option.value, locale)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{text.calloutDepth}</span>
            <select
              value={calloutOptions.calloutDepth}
              disabled={disabled || preparing}
              onChange={(event) => review.setCalloutOptions(item.id, { calloutDepth: event.target.value as EditorialCalloutDepth })}
            >
              {getEditorialCalloutDepthOptions(locale).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {calloutReady ? <em>{text.calloutOptionsHint}</em> : null}
        </div>
      ) : null}
      {focused && spell && !stale && spell.suggestions.length > 1 ? (
        <div className={styles.options} onClick={(event) => event.stopPropagation()}>
          <span>{text.spellSuggestions}</span>
          <span className={styles.seg} role="group" aria-label={text.spellSuggestions}>
            {spell.suggestions.slice(0, 6).map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                className={suggestion === replacement ? styles.segOn : undefined}
                aria-pressed={suggestion === replacement}
                disabled={disabled}
                onClick={() => review.chooseSuggestion(item.id, index)}
              >
                {suggestion}
              </button>
            ))}
          </span>
        </div>
      ) : null}
      {spell && !stale && !replacement ? <p className={styles.cardNote}>{text.spellNoSuggestion}</p> : null}
      {preparing ? (
        <p className={styles.busy} role="status">
          <span className={styles.spin} />
          {kind === "callout" ? text.preparingCallout : text.preparing}
        </p>
      ) : null}
      {stale && !preparing ? <p className={styles.cardNote}>{staleNote}</p> : null}
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
      {showRefine ? (
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
      {showRefine && hasInstruction && (ready || calloutReady) ? <p className={styles.cardNote}>{text.refinePending}</p> : null}
      <footer>
        {quiet ? (
          <span className={styles.nav}>
            <button type="button" className={styles.tb} title={text.previous} aria-label={text.previous} onClick={stop(() => review.moveFocus(-1))}>
              <V2Icon name="left" />
            </button>
            <button type="button" className={styles.tb} title={text.next} aria-label={text.next} onClick={stop(() => review.moveFocus(1))}>
              <V2Icon name="right" />
            </button>
          </span>
        ) : null}
        {spell && !stale ? (
          <button type="button" className={cx(styles.btn, styles.btnGhost)} disabled={disabled} onClick={stop(() => review.addToDictionary(item.id))}>
            {text.addToDictionary}
          </button>
        ) : null}
        <button type="button" className={cx(styles.btn, styles.btnGhost)} disabled={disabled} onClick={stop(() => review.rejectItem(item.id))}>
          {spell ? text.ignore : text.reject}
        </button>
        {main}
      </footer>
    </article>
  );
}

/** "абз. 3", "абз. 3–4", "заголовок": the paragraph numbers are the ones shown in the manuscript gutter. */
function createWhereLabel(document: EditorDocument | null, text: V2Copy["edits"]): (item: V2ReviewItem) => string {
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
