"use client";

import type { StructureOutlineNode, StructureOutlineTreeModel } from "../../lib/editor/structure-outline";

export function StructureOutlineTree({
  model,
  activeReviewItemId,
  preparingReviewItemId,
  emptyLabel,
  onFocusExisting,
  onFocusProposed
}: {
  model: StructureOutlineTreeModel;
  activeReviewItemId: string | null;
  preparingReviewItemId: string | null;
  emptyLabel: string;
  onFocusExisting: (blockId: string) => void;
  onFocusProposed: (reviewItemId: string) => void;
}) {
  const hasNodes = model.nodes.length > 0;

  return (
    <div className="structure-bare-tree" aria-label={model.rootTitle}>
      <div className="structure-bare-tree-root">{model.rootTitle}</div>
      {hasNodes ? (
        <ul className="structure-bare-tree-list">
          {model.nodes.map((node) => (
            <OutlineBranch
              key={node.id}
              node={node}
              activeReviewItemId={activeReviewItemId}
              preparingReviewItemId={preparingReviewItemId}
              onFocusExisting={onFocusExisting}
              onFocusProposed={onFocusProposed}
            />
          ))}
        </ul>
      ) : (
        <p className="structure-bare-tree-empty">{emptyLabel}</p>
      )}
    </div>
  );
}

function OutlineBranch({
  node,
  activeReviewItemId,
  preparingReviewItemId,
  onFocusExisting,
  onFocusProposed
}: {
  node: StructureOutlineNode;
  activeReviewItemId: string | null;
  preparingReviewItemId: string | null;
  onFocusExisting: (blockId: string) => void;
  onFocusProposed: (reviewItemId: string) => void;
}) {
  const isProposed = node.kind === "proposed";
  const isActive = Boolean(isProposed && node.reviewItemId && node.reviewItemId === activeReviewItemId);
  const isPreparing = Boolean(isProposed && node.reviewItemId && node.reviewItemId === preparingReviewItemId);
  const isDismissed = node.status === "dismissed";

  return (
    <li
      className="structure-bare-tree-item"
      data-kind={node.kind}
      data-level={node.level}
      data-active={isActive ? "true" : "false"}
      data-status={node.status ?? undefined}
      data-dismissed={isDismissed ? "true" : "false"}
    >
      <button
        type="button"
        className="structure-bare-tree-label"
        aria-pressed={isProposed ? isActive : undefined}
        aria-busy={isPreparing || undefined}
        onClick={() => {
          if (isProposed && node.reviewItemId) {
            onFocusProposed(node.reviewItemId);
            return;
          }
          if (node.blockId) {
            onFocusExisting(node.blockId);
          }
        }}
      >
        <span className="structure-bare-tree-label-text">{node.title}</span>
        {isPreparing ? (
          <span className="loading-inline-dots structure-bare-tree-loading" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
        ) : null}
      </button>
      {node.children.length > 0 ? (
        <ul className="structure-bare-tree-list">
          {node.children.map((child) => (
            <OutlineBranch
              key={child.id}
              node={child}
              activeReviewItemId={activeReviewItemId}
              preparingReviewItemId={preparingReviewItemId}
              onFocusExisting={onFocusExisting}
              onFocusProposed={onFocusProposed}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
