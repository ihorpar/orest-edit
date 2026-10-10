"use client";

import { memo, useRef, type RefObject } from "react";
import type { EditorDocument } from "../../lib/editor/document-model";
import type { AppLocale } from "../../lib/i18n/product-locale";
import { getTabForKey } from "../../lib/v2/a11y";
import type { V2Copy } from "../../lib/v2/copy";
import type { FragmentScope } from "../../lib/v2/fragment-actions";
import type { ReviewDiffReport } from "../../lib/v2/review-marks";
import { selectOpenItems } from "../../lib/v2/store";
import { AskTab } from "./AskTab";
import { EditsTab } from "./EditsTab";
import { V2Icon, type V2IconName } from "./icons";
import { OverviewTab } from "./OverviewTab";
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
  locale: AppLocale;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  review: ReviewEngine;
  diffReport: ReviewDiffReport;
  document: EditorDocument | null;
  chapterTitle: string;
  /** AI actions are off because the draft cannot be saved. */
  aiDisabled: boolean;
  /** The fragment the `Запит` tab is scoped to, or null for the whole chapter. */
  askScope: FragmentScope | null;
  onAskScopeClear: () => void;
  askDraft: string;
  onAskDraftChange: (text: string) => void;
  askInputRef: RefObject<HTMLTextAreaElement | null>;
  onNotify: (tone: "info" | "error", message: string) => void;
}

/**
 * Right-hand panel with the three tabs: `Огляд` reads the chapter, `Правки` is the one queue of suggestions,
 * `Запит` takes the editor's own instruction. All three drive the same suggestion engine.
 */
export const V2Panel = memo(function V2Panel({
  copy,
  locale,
  tab,
  onTabChange,
  review,
  diffReport,
  document,
  chapterTitle,
  aiDisabled,
  askScope,
  onAskScopeClear,
  askDraft,
  onAskDraftChange,
  askInputRef,
  onNotify
}: V2PanelProps) {
  const openCount = selectOpenItems(review.state).length;
  const openEdits = () => onTabChange("edits");
  const tabsRef = useRef<HTMLDivElement>(null);

  return (
    <aside className={styles.panel} aria-label={copy.a11y.panel} data-v2-panel>
      <div className={styles.tabs} role="tablist" aria-label={copy.a11y.panel} ref={tabsRef}>
        {TABS.map(({ id, icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`v2-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="v2-panel-body"
            // One stop in the tab order; the arrows move between the tabs and open them.
            tabIndex={tab === id ? 0 : -1}
            className={`${styles.tab} ${tab === id ? styles.tabOn : ""}`}
            onClick={() => onTabChange(id)}
            onKeyDown={(event) => {
              const next = getTabForKey(
                TABS.map((entry) => entry.id),
                id,
                event.key
              );

              if (next && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                onTabChange(next);
                tabsRef.current?.querySelector<HTMLElement>(`#v2-tab-${next}`)?.focus();
              }
            }}
          >
            <V2Icon name={icon} />
            <span>{copy.tabs[id]}</span>
            {id === "edits" && openCount > 0 ? <b>{openCount}</b> : null}
          </button>
        ))}
      </div>
      <div className={styles.body} id="v2-panel-body" role="tabpanel" aria-labelledby={`v2-tab-${tab}`} data-view={tab} tabIndex={-1}>
        {tab === "overview" ? (
          <OverviewTab
            copy={copy}
            review={review}
            document={document}
            chapterTitle={chapterTitle}
            disabled={aiDisabled}
            onOpenEdits={openEdits}
            onNotify={onNotify}
          />
        ) : tab === "edits" ? (
          <EditsTab copy={copy} locale={locale} review={review} diffReport={diffReport} document={document} disabled={aiDisabled} />
        ) : (
          <AskTab
            copy={copy}
            review={review}
            document={document}
            disabled={aiDisabled}
            scope={askScope}
            onClearScope={onAskScopeClear}
            draft={askDraft}
            onDraftChange={onAskDraftChange}
            inputRef={askInputRef}
            onOpenEdits={openEdits}
          />
        )}
      </div>
      <footer className={styles.foot}>
        <a href="/settings">{copy.settings}</a>
      </footer>
    </aside>
  );
});
