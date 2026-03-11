import { useState } from "react";
import { Button } from "../ui/Button";
import type { Block } from "../../lib/editor/document-model";
import { getBlockText } from "../../lib/editor/document-model";

export function BlockDiffOverlay({
    oldBlocks,
    newBlocks,
    reason,
    onAccept,
    onReject
}: {
    oldBlocks: Block[];
    newBlocks: Block[];
    reason: string;
    onAccept: (editedText: string) => void;
    onReject: () => void;
}) {
    const [editedText, setEditedText] = useState(
        newBlocks.map((b) => getBlockText(b)).join("\n\n")
    );

    return (
        <div className="block-diff-inline-container">
            <div className="diff-text-old">
                {oldBlocks.map((b, i) => (
                    <p key={i} style={{ margin: 0, paddingBottom: i === oldBlocks.length - 1 ? 0 : '8px' }}>
                        {getBlockText(b)}
                    </p>
                ))}
            </div>
            <textarea
                className="diff-textarea diff-add-editor"
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                style={{ resize: 'vertical' }}
            />
            <div className="diff-footer button-row" style={{ marginTop: '8px' }}>
                <span className="diff-reason" style={{ marginRight: 'auto' }}>{reason}</span>
                <Button size="sm" variant="ghost" onClick={onReject}>Скасувати</Button>
                <Button size="sm" variant="primary" onClick={() => onAccept(editedText)}>Застосувати</Button>
            </div>
        </div>
    );
}
