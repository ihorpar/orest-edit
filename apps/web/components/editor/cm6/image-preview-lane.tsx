"use client";

import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { resolveEditorAssetUrl } from "../../../lib/editor/asset-store";
import { resolveOffsetLaneAnchor } from "../../../lib/editor/cm6/recommendation-positions";
import type { MarkdownImageBlock } from "../../../lib/editor/markdown-editor";

export function ImagePreviewLane({
  editorView,
  block,
  canMoveUp,
  canMoveDown,
  layoutKey,
  onMoveUp,
  onMoveDown
}: {
  editorView: EditorView | null;
  block: MarkdownImageBlock;
  canMoveUp: boolean;
  canMoveDown: boolean;
  layoutKey: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [anchorTop, setAnchorTop] = useState(0);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    function updateAnchor() {
      if (!editorView) {
        return;
      }

      const anchor = resolveOffsetLaneAnchor(editorView, block.start, block.end);
      setAnchorTop(anchor.top);
    }

    updateAnchor();
    window.addEventListener("resize", updateAnchor);

    return () => {
      window.removeEventListener("resize", updateAnchor);
    };
  }, [block.end, block.start, editorView, layoutKey]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void resolveEditorAssetUrl(block.source)
      .then((url) => {
        if (!cancelled) {
          setResolvedUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [block.source]);

  return (
    <aside className="cm-orest-side-panel cm-orest-image-preview-lane" style={{ top: anchorTop }}>
      <div className="cm-orest-side-panel-card cm-orest-image-preview-card">
        <div className="cm-orest-image-preview-head">
          <div>
            <p className="mono-ui cm-orest-image-preview-kicker">Зображення</p>
            <p className="mono-ui cm-orest-image-preview-source">{block.source}</p>
          </div>
          <div className="cm-orest-image-preview-actions">
            <button type="button" className="mono-ui cm-orest-image-preview-button" onClick={onMoveUp} disabled={!canMoveUp}>
              Вище
            </button>
            <button type="button" className="mono-ui cm-orest-image-preview-button" onClick={onMoveDown} disabled={!canMoveDown}>
              Нижче
            </button>
          </div>
        </div>
        <div className="cm-orest-image-preview-frame" data-loading={isLoading ? "true" : "false"}>
          {isLoading ? <p className="mono-ui cm-orest-image-preview-status">Завантажую прев'ю…</p> : null}
          {!isLoading && resolvedUrl ? <img src={resolvedUrl} alt={block.alt || "Зображення"} /> : null}
          {!isLoading && !resolvedUrl ? <p className="mono-ui cm-orest-image-preview-status">Зображення недоступне</p> : null}
        </div>
        <div className="cm-orest-image-preview-copy">
          <p className="cm-orest-image-preview-title">{block.alt || "Зображення"}</p>
          {block.caption ? <p className="cm-orest-image-preview-caption">{block.caption}</p> : null}
        </div>
      </div>
    </aside>
  );
}
