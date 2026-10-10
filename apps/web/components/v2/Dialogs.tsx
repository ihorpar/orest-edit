"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { getInlineText, type Block, type InlineNode } from "../../lib/editor/document-model";
import type { AppLocale } from "../../lib/i18n/product-locale";
import { formatV2Date, type V2Copy } from "../../lib/v2/copy";
import { getReplaceStatus } from "../../lib/v2/global-replace";
import { formatHistoryWhere, HISTORY_LIMIT, type V2HistoryEntry } from "../../lib/v2/history";
import type { ManuscriptRequest, RecoveryPromise } from "../../lib/v2/manuscript-session";
import { diffWords } from "../../lib/v2/word-diff";
import { V2Icon } from "./icons";
import styles from "./v2.module.css";

interface ModalProps {
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** Wider box for content that is read side by side. */
  wide?: boolean;
  /** `alertdialog` for a question that must be answered before anything else. */
  alert?: boolean;
  describedBy?: string;
  dataName: string;
  children: ReactNode;
}

/**
 * A modal over the editor, on the native `<dialog>`: the browser keeps keyboard focus inside it, makes the
 * page behind it inert, closes it on Escape and gives focus back to where it was.
 */
function Modal({ title, closeLabel, onClose, wide, alert, describedBy, dataName, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;

    if (!dialog) {
      return;
    }

    const opener = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;

    if (!dialog.open) {
      dialog.showModal();
    }

    // The browser focuses the first control (the close button); a dialog may name a better start.
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    return () => {
      if (dialog.open) {
        dialog.close();
      }

      // Back to where the keyboard was, when that place is still on the page.
      if (opener && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`${styles.modal} ${wide ? styles.modalWide : ""}`}
      role={alert ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      data-v2-dialog={dataName}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onMouseDown={(event) => {
        // A press on the backdrop (the dialog element itself, outside its box) closes it.
        if (event.target === event.currentTarget) {
          closeRef.current();
        }
      }}
    >
      <div className={styles.modalBox}>
        <header className={styles.modalHead}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className={styles.tb} aria-label={closeLabel} title={closeLabel} onClick={onClose}>
            <V2Icon name="x" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

/* ---------- confirmation ---------- */

interface ConfirmDialogProps {
  copy: V2Copy;
  request: ManuscriptRequest;
  /** What will really be recoverable afterwards; the dialog says exactly that. */
  promise: RecoveryPromise;
  locale: AppLocale;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The question before the manuscript is cleared, replaced or started over. Cancel is the default button. */
export function ConfirmDialog({ copy, request, promise, locale, onConfirm, onCancel }: ConfirmDialogProps) {
  const text = copy.confirm;
  const bodyId = useId();
  const content =
    request.kind === "clear"
      ? { title: text.clearTitle, body: text.clearText, action: text.clearAction }
      : request.kind === "open"
        ? { title: text.openTitle, body: text.openText, action: text.openAction }
        : { title: text.restartTitle, body: text.restartText, action: text.restartAction };
  // Starting over explains itself; the other two say what can and what cannot be brought back.
  const recovery =
    request.kind === "restart"
      ? null
      : promise.kind === "none"
        ? text.recoveryNone
        : promise.kind === "kept"
          ? text.recoveryKept
          : `${text.recoveryKept} ${text.recoveryDropsOldest(formatV2Date(promise.dropped.at, locale, "short"))}`;

  return (
    <Modal title={content.title} closeLabel={text.cancel} onClose={onCancel} alert describedBy={bodyId} dataName={`confirm-${request.kind}`}>
      <div id={bodyId} className={styles.modalText}>
        <p>{content.body}</p>
        {recovery ? <p data-confirm-recovery={promise.kind}>{recovery}</p> : null}
      </div>
      <footer className={styles.modalFoot}>
        <button type="button" className={`${styles.btn} ${styles.btnOutline}`} data-autofocus data-confirm-cancel onClick={onCancel}>
          {text.cancel}
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnDanger}`} data-confirm-action onClick={onConfirm}>
          {content.action}
        </button>
      </footer>
    </Modal>
  );
}

/* ---------- find and replace ---------- */

interface ReplaceDialogProps {
  copy: V2Copy;
  /** Counts the matches of a query in the manuscript as it is right now. */
  countMatches: (query: string) => number;
  /** Replaces all; returns how many were replaced (0 when nothing could be done). */
  onReplace: (query: string, replacement: string) => number;
  onClose: () => void;
}

export function ReplaceDialog({ copy, countMatches, onReplace, onClose }: ReplaceDialogProps) {
  const text = copy.replace;
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [failed, setFailed] = useState(false);
  const statusId = useId();
  const findId = useId();
  const withId = useId();
  // Counted for what is typed, not on every render of the page behind.
  const count = useMemo(() => countMatches(query), [countMatches, query]);
  const status = getReplaceStatus(count, query, replacement);
  const message = failed
    ? text.failed
    : status.kind === "empty"
      ? text.typeQuery
      : status.kind === "none"
        ? text.none
        : status.kind === "same"
          ? `${text.count(status.count)}. ${text.same}`
          : text.count(status.count);

  const submit = () => {
    if (status.kind !== "ready") {
      return;
    }

    if (onReplace(query, replacement) > 0) {
      onClose();
    } else {
      setFailed(true);
    }
  };

  return (
    <Modal title={text.title} closeLabel={text.close} onClose={onClose} dataName="replace">
      <form
        className={styles.modalForm}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={findId}>{text.find}</label>
        <input
          id={findId}
          type="text"
          data-autofocus
          autoComplete="off"
          spellCheck={false}
          value={query}
          aria-describedby={statusId}
          data-replace-find
          onChange={(event) => {
            setFailed(false);
            setQuery(event.target.value);
          }}
        />
        <label htmlFor={withId}>{text.with}</label>
        <input
          id={withId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={replacement}
          data-replace-with
          onChange={(event) => {
            setFailed(false);
            setReplacement(event.target.value);
          }}
        />
        <p
          id={statusId}
          className={`${styles.modalStatus} ${failed || status.kind === "none" ? styles.modalStatusBad : ""}`}
          role="status"
          data-replace-status={failed ? "failed" : status.kind}
        >
          {message}
        </p>
        <p className={styles.modalHint}>{text.hint}</p>
        <footer className={styles.modalFoot}>
          <button type="button" className={`${styles.btn} ${styles.btnOutline}`} onClick={onClose}>
            {text.close}
          </button>
          <button type="submit" className={`${styles.btn} ${styles.btnSolid}`} disabled={status.kind !== "ready"} data-replace-action>
            {text.action}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/* ---------- hotkeys ---------- */

export function HotkeysDialog({ copy, onClose }: { copy: V2Copy; onClose: () => void }) {
  const text = copy.hotkeys;

  return (
    <Modal title={text.title} closeLabel={text.close} onClose={onClose} wide dataName="hotkeys">
      <div className={styles.hotkeys}>
        {text.groups.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.items.map((item) => (
                <div key={`${item.keys}-${item.text}`}>
                  <dt>
                    <kbd>{item.keys}</kbd>
                  </dt>
                  <dd>{item.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className={styles.modalHint}>{text.macNote}</p>
    </Modal>
  );
}

/* ---------- change history ---------- */

interface HistoryDialogProps {
  copy: V2Copy;
  locale: AppLocale;
  /** Oldest first, as stored. */
  entries: V2HistoryEntry[];
  onClose: () => void;
}

function describeEntry(entry: V2HistoryEntry, copy: V2Copy): string {
  const text = copy.historyPanel;
  const sourceName =
    copy.edits.passList.find((pass) => pass.id === entry.source)?.name ??
    (entry.source === "fact" || entry.source === "request" ? copy.edits.sourceNames[entry.source] : null);

  if (entry.kind === "globalReplace") {
    return `${text.kinds.globalReplace}: ${text.replaceLabel(entry.find ?? "", entry.replacement ?? "")}`;
  }

  if (entry.kind === "bulk") {
    return text.bulkLabel(sourceName ? `${text.kinds.bulk} — ${sourceName}` : text.kinds.bulk, entry.count ?? 0);
  }

  const kind = text.kinds[entry.kind];
  return sourceName && sourceName !== kind ? `${kind} · ${sourceName}` : kind;
}

function Inline({ nodes }: { nodes: InlineNode[] | undefined }) {
  return (
    <>
      {(nodes ?? []).map((node, index) => {
        let content: ReactNode = node.text;

        if (node.italic) {
          content = <em>{content}</em>;
        }

        if (node.bold) {
          content = <strong>{content}</strong>;
        }

        return <span key={index}>{content}</span>;
      })}
    </>
  );
}

function getTextContent(block: Block | undefined): InlineNode[] | null {
  return block && (block.type === "paragraph" || block.type === "heading") ? block.content : null;
}

/** One block of a comparison. With `counterpart`, a changed text shows what went (`side: before`) or came. */
function HistoryBlock({ block, counterpart, side, copy }: { block: Block; counterpart?: Block; side: "before" | "after"; copy: V2Copy }) {
  const text = copy.historyPanel;

  switch (block.type) {
    case "paragraph":
    case "heading": {
      const own = getInlineText(block.content);
      const other = getTextContent(counterpart);
      const otherText = other ? getInlineText(other) : null;
      const className = block.type === "heading" ? styles.cmpHeading : undefined;

      if (otherText === null || otherText === own) {
        return (
          <p className={className}>
            <Inline nodes={block.content} />
          </p>
        );
      }

      const segments = side === "before" ? diffWords(own, otherText) : diffWords(otherText, own);

      return (
        <p className={className}>
          {segments.map((segment, index) =>
            segment.kind === "equal" ? (
              <span key={index}>{segment.text}</span>
            ) : segment.kind === "delete" ? (
              side === "before" ? <del key={index}>{segment.text}</del> : null
            ) : side === "after" ? (
              <ins key={index}>{segment.text}</ins>
            ) : null
          )}
        </p>
      );
    }
    case "bullet_list":
    case "ordered_list": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <Inline nodes={item} />
        </li>
      ));
      return block.type === "bullet_list" ? <ul>{items}</ul> : <ol>{items}</ol>;
    }
    case "callout":
      return (
        <div className={styles.cmpCallout}>
          <p>
            <strong>
              <Inline nodes={block.title} />
            </strong>
          </p>
          {block.body.map((paragraph, index) => (
            <p key={index}>
              <Inline nodes={paragraph} />
            </p>
          ))}
        </div>
      );
    case "image": {
      const caption = getInlineText(block.caption ?? []);
      return (
        <p className={styles.cmpMeta}>
          {text.image}: {[block.alt, caption].filter(Boolean).join(" — ") || block.assetId}
        </p>
      );
    }
    case "divider":
      return <p className={styles.cmpMeta}>{text.divider}</p>;
    case "table":
      return (
        <p className={styles.cmpMeta}>
          {text.table}: {block.rows.map((row) => row.map((cell) => getInlineText(cell)).join(" | ")).join(" / ")}
        </p>
      );
  }
}

function HistorySide({ label, blocks, others, side, emptyText, copy }: {
  label: string;
  blocks: Block[];
  others: Block[];
  side: "before" | "after";
  emptyText: string;
  copy: V2Copy;
}) {
  const byId = new Map(others.map((block) => [block.id, block]));

  return (
    <section className={styles.cmpSide} data-history-side={side} aria-label={label}>
      <h3>{label}</h3>
      {blocks.length === 0 ? <p className={styles.cmpMeta}>{emptyText}</p> : null}
      {blocks.map((block) => (
        <HistoryBlock key={block.id} block={block} counterpart={byId.get(block.id)} side={side} copy={copy} />
      ))}
    </section>
  );
}

/** `Історія`: the accepted changes of this draft, newest first; each opens its `Було` / `Стало`. */
export function HistoryDialog({ copy, locale, entries, onClose }: HistoryDialogProps) {
  const text = copy.historyPanel;
  const [openId, setOpenId] = useState<string | null>(null);
  const ordered = useMemo(() => [...entries].reverse(), [entries]);
  const opened = openId ? ordered.find((entry) => entry.id === openId) ?? null : null;
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (opened) {
      backRef.current?.focus();
    }
  }, [opened]);

  return (
    <Modal title={text.title} closeLabel={text.close} onClose={onClose} wide dataName="history">
      {opened ? (
        <div data-history-compare={opened.id}>
          <div className={styles.cmpBar}>
            <button type="button" className={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`} ref={backRef} onClick={() => setOpenId(null)}>
              <V2Icon name="left" />
              {text.back}
            </button>
            <span>
              <b>{describeEntry(opened, copy)}</b> · {formatHistoryWhere(opened.where, copy.edits)} · {formatV2Date(opened.at, locale, "short")}
            </span>
          </div>
          <div className={styles.cmp}>
            <HistorySide label={text.before} blocks={opened.before} others={opened.after} side="before" emptyText={text.nothingBefore} copy={copy} />
            <HistorySide label={text.after} blocks={opened.after} others={opened.before} side="after" emptyText={text.nothingAfter} copy={copy} />
          </div>
          {opened.omitted ? <p className={styles.modalHint}>+ {text.blocks(opened.omitted)}</p> : null}
        </div>
      ) : (
        <>
          {ordered.length === 0 ? (
            <p className={styles.modalEmpty} data-history-empty>
              {text.empty}
            </p>
          ) : (
            <>
              <ul className={styles.histList} data-history-list>
                {ordered.map((entry) => {
                  const label = describeEntry(entry, copy);

                  return (
                    <li key={entry.id}>
                      <button type="button" data-history-entry={entry.kind} aria-label={text.open(label)} onClick={() => setOpenId(entry.id)}>
                        <b>{label}</b>
                        <span>{formatHistoryWhere(entry.where, copy.edits)}</span>
                        <time dateTime={entry.at}>{formatV2Date(entry.at, locale, "short")}</time>
                        <V2Icon name="right" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className={styles.modalHint}>
                {text.count(ordered.length)}
              </p>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
