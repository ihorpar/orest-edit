"use client";

import type { EditorDocument } from "../../lib/editor/document-model";
import type { V2Copy } from "../../lib/v2/copy";
import type { ReviewDiffReport } from "../../lib/v2/review-marks";
import { selectOpenItems } from "../../lib/v2/store";
import { EditsTab } from "./EditsTab";
import { V2Icon, type V2IconName } from "./icons";
import type { ReviewEngine } from "./useReviewEngine";
import styles from "./v2.module.css";

export type PanelTab = "overview" | "edits" | "ask";

const TABS: Array<{ id: PanelTab; icon: V2IconName }> = [
  { id: "overview", icon: "eye" },
  { id: "edits", icon: "checks" },
  { id: "ask", icon: "chat" }
];

interface V2PanelProps {
  copy: V2Copy;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  review: ReviewEngine;
  diffReport: ReviewDiffReport;
  document: EditorDocument | null;
  /** AI actions are off because the draft cannot be saved. */
  aiDisabled: boolean;
}

/**
 * Right-hand panel with the three tabs. `Правки` runs the suggestion engine; `Огляд` and `Запит` are wired
 * in later milestones, so their launchers are disabled and they render no model output.
 */
export function V2Panel({ copy, tab, onTabChange, review, diffReport, document, aiDisabled }: V2PanelProps) {
  const openCount = selectOpenItems(review.state).length;

  return (
    <aside className={styles.panel}>
      <nav className={styles.tabs} role="tablist">
        {TABS.map(({ id, icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`v2-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="v2-panel-body"
            className={`${styles.tab} ${tab === id ? styles.tabOn : ""}`}
            onClick={() => onTabChange(id)}
          >
            <V2Icon name={icon} />
            <span>{copy.tabs[id]}</span>
            {id === "edits" && openCount > 0 ? <b>{openCount}</b> : null}
          </button>
        ))}
      </nav>
      <div className={styles.body} id="v2-panel-body" role="tabpanel" aria-labelledby={`v2-tab-${tab}`} data-view={tab}>
        {tab === "overview" ? (
          <OverviewTab copy={copy} />
        ) : tab === "edits" ? (
          <EditsTab copy={copy} review={review} diffReport={diffReport} document={document} disabled={aiDisabled} />
        ) : (
          <AskTab copy={copy} />
        )}
      </div>
      <footer className={styles.foot}>
        {copy.footer} · <a href="/settings">{copy.settings}</a>
      </footer>
    </aside>
  );
}

function OverviewTab({ copy }: { copy: V2Copy }) {
  return (
    <>
      <h2>{copy.overview.title}</h2>
      <p className={styles.lead}>{copy.overview.lead}</p>
      <div className={styles.starter}>
        <div>
          <b>{copy.overview.diagnostics}</b>
          <p>{copy.overview.diagnosticsText}</p>
        </div>
        <button type="button" className={`${styles.btn} ${styles.btnSolid}`} disabled title={copy.notConnected}>
          {copy.overview.diagnosticsAction}
        </button>
      </div>
      <div className={styles.starter}>
        <div>
          <b>{copy.overview.factCheck}</b>
          <p>{copy.overview.factCheckText}</p>
        </div>
        <button type="button" className={`${styles.btn} ${styles.btnOutline}`} disabled title={copy.notConnected}>
          {copy.overview.factCheckAction}
        </button>
      </div>
      <p className={styles.pending}>{copy.aiPending}</p>
    </>
  );
}

function AskTab({ copy }: { copy: V2Copy }) {
  return (
    <>
      <h2>{copy.ask.title}</h2>
      <p className={styles.lead}>{copy.ask.lead}</p>
      <div className={styles.scope}>
        <span>{copy.ask.scope}</span>
        <em>{copy.ask.scopeHint}</em>
      </div>
      <div className={styles.composer}>
        <textarea className={styles.askq} rows={4} placeholder={copy.ask.placeholder} disabled aria-label={copy.ask.title} />
        <button type="button" className={`${styles.btn} ${styles.btnSolid}`} disabled title={copy.notConnected}>
          {copy.ask.send}
        </button>
      </div>
      <p className={styles.pending}>{copy.aiPending}</p>
    </>
  );
}
