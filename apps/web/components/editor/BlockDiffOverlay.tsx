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
        <div className="block-diff-overlay">
            <div className="diff-card">
                <div className="diff-head">
                    <span className="mono-ui diff-badge">Правка ШІ</span>
                    <p className="diff-reason">{reason}</p>
                </div>

                <div className="diff-body">
                    <div className="diff-section diff-section-old">
                        <span className="mono-ui diff-label">Було:</span>
                        <div className="diff-text-old">
                            {oldBlocks.map((b, i) => (
                                <p key={i} className="diff-del">
                                    {getBlockText(b)}
                                </p>
                            ))}
                        </div>
                    </div>

                    <div className="diff-section diff-section-new">
                        <span className="mono-ui diff-label">Новий варіант:</span>
                        <textarea
                            className="diff-textarea"
                            value={editedText}
                            onChange={(e) => setEditedText(e.target.value)}
                        />
                    </div>
                </div>

                <div className="diff-footer button-row">
                    <Button size="sm" variant="ghost" onClick={onReject}>Відхилити</Button>
                    <Button size="sm" variant="primary" onClick={() => onAccept(editedText)}>Прийняти</Button>
                </div>
            </div>
        </div>
    );
}
