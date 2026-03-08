"use client";

import { createRoot, type Root } from "react-dom/client";
import { useEffect, useState } from "react";
import { Decoration, WidgetType } from "@codemirror/view";
import type { MarkdownImageBlock } from "../markdown-editor";
import { resolveEditorAssetUrl } from "../asset-store";

function MarkdownImageWidgetView({
  block,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown
}: {
  block: MarkdownImageBlock;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
    <figure className="cm-orest-image-widget" data-loading={isLoading ? "true" : "false"}>
      <div className="cm-orest-image-widget-toolbar">
        <span className="mono-ui cm-orest-image-widget-label">Зображення</span>
        <div className="cm-orest-image-widget-actions">
          <button type="button" className="mono-ui cm-orest-image-widget-button" onClick={onMoveUp} disabled={!canMoveUp}>
            Вище
          </button>
          <button type="button" className="mono-ui cm-orest-image-widget-button" onClick={onMoveDown} disabled={!canMoveDown}>
            Нижче
          </button>
        </div>
      </div>
      {isLoading ? <div className="mono-ui cm-orest-image-widget-status">Завантажую прев'ю…</div> : null}
      {!isLoading && resolvedUrl ? <img src={resolvedUrl} alt={block.alt || "Зображення"} /> : null}
      {!isLoading && !resolvedUrl ? <div className="mono-ui cm-orest-image-widget-status">Зображення недоступне</div> : null}
      <figcaption>
        <strong>{block.alt || "Зображення"}</strong>
        {block.caption ? <span>{block.caption}</span> : null}
      </figcaption>
    </figure>
  );
}

class MarkdownImageWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    private readonly block: MarkdownImageBlock,
    private readonly canMoveUp: boolean,
    private readonly canMoveDown: boolean,
    private readonly onMoveUp: () => void,
    private readonly onMoveDown: () => void
  ) {
    super();
  }

  eq(other: MarkdownImageWidget) {
    return (
      this.block.markdown === other.block.markdown &&
      this.block.source === other.block.source &&
      this.block.caption === other.block.caption &&
      this.canMoveUp === other.canMoveUp &&
      this.canMoveDown === other.canMoveDown
    );
  }

  toDOM() {
    const mountNode = document.createElement("div");
    mountNode.className = "cm-orest-image-widget-shell";
    this.root = createRoot(mountNode);
    this.root.render(
      <MarkdownImageWidgetView
        block={this.block}
        canMoveUp={this.canMoveUp}
        canMoveDown={this.canMoveDown}
        onMoveUp={this.onMoveUp}
        onMoveDown={this.onMoveDown}
      />
    );
    return mountNode;
  }

  ignoreEvent() {
    return false;
  }

  destroy() {
    this.root?.unmount();
    this.root = null;
  }
}

export function createImageWidgetDecoration(input: {
  block: MarkdownImageBlock;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return Decoration.widget({
    widget: new MarkdownImageWidget(input.block, input.canMoveUp, input.canMoveDown, input.onMoveUp, input.onMoveDown),
    side: 1,
    block: true
  });
}
