import type { PatchOperation } from "../../lib/editor/patch-contract";
import { Button } from "../ui/Button";

export function OperationCard({
  operation,
  onAccept,
  onReject
}: {
  operation: PatchOperation;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <article className="editor-note-card">
      <div className="editor-note-head">
        <p className="editor-note-title">{operation.reason}</p>
        <span className="mono-ui editor-note-badge">{operation.type}</span>
      </div>
      <div className="block-diff-card">
        <div>
          <p className="mono-ui block-diff-label">Було</p>
          <pre className="block-diff-copy">{operation.oldBlocks.map((block) => blockPreview(block)).join("\n\n")}</pre>
        </div>
        <div>
          <p className="mono-ui block-diff-label">Стане</p>
          <pre className="block-diff-copy">{operation.newBlocks.map((block) => blockPreview(block)).join("\n\n")}</pre>
        </div>
      </div>
      <div className="button-row">
        <Button size="sm" variant="secondary" onClick={() => onReject(operation.id)}>
          Відхилити
        </Button>
        <Button size="sm" variant="primary" onClick={() => onAccept(operation.id)}>
          Прийняти
        </Button>
      </div>
    </article>
  );
}

function blockPreview(block: PatchOperation["oldBlocks"][number]): string {
  if (block.type === "paragraph" || block.type === "heading") {
    return block.content.map((node) => node.text).join("");
  }

  if (block.type === "bullet_list" || block.type === "ordered_list") {
    return block.items.map((item) => item.map((node) => node.text).join("")).join("\n");
  }

  if (block.type === "callout") {
    return [block.title.map((node) => node.text).join(""), ...block.body.map((item) => item.map((node) => node.text).join(""))].join("\n");
  }

  if (block.type === "table") {
    return block.rows.map((row) => row.map((cell) => cell.map((node) => node.text).join("")).join(" | ")).join("\n");
  }

  if (block.type === "image") {
    return [block.alt, block.caption?.map((node) => node.text).join("")].filter(Boolean).join("\n");
  }

  return "—";
}
