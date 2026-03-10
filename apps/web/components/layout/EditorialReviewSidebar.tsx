import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import type { EditorialReviewItem, ChatMessage, ReviewSessionStatus } from "../../lib/editor/review-contract";
import { EditorialReviewCard } from "../editor/EditorialReviewCard";
import { Button } from "../ui/Button";

export function EditorialReviewSidebar({
    status,
    expertise,
    history,
    reviewItems,
    reviewLoading,
    activeReviewItemId,
    revision,
    onChat,
    onGenerateCards,
    onBackToChat,
    onFocusReviewItem,
    onPrepareReviewItem,
    onApplyCallout,
    onDismissReviewItem
}: {
    status: ReviewSessionStatus;
    expertise: string | null;
    history: ChatMessage[];
    reviewItems: EditorialReviewItem[];
    reviewLoading?: boolean;
    activeReviewItemId?: string | null;
    revision: ManuscriptRevisionState;
    onChat: (message: string) => void;
    onGenerateCards: () => void;
    onBackToChat: () => void;
    onFocusReviewItem: (item: EditorialReviewItem) => void;
    onPrepareReviewItem: (item: EditorialReviewItem) => void;
    onApplyCallout: (item: EditorialReviewItem) => void;
    onDismissReviewItem: (item: EditorialReviewItem) => void;
}) {
    const [inputText, setInputText] = useState("");
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [history, expertise]);

    const handleSend = () => {
        if (!inputText.trim()) return;
        onChat(inputText.trim());
        setInputText("");
    };

    return (
        <div className="review-sidebar">
            <div className="review-sidebar-head">
                <div>
                    <p className="mono-ui operations-title">AI Редактор</p>
                    <h2 className="review-sidebar-title">
                        {status === "expertise" ? "Експертиза" : "Правки"}
                    </h2>
                </div>
                <div className="button-row">
                    {status === "expertise" && expertise && (
                        <Button size="sm" variant="primary" onClick={onGenerateCards} disabled={reviewLoading}>
                            Правки
                        </Button>
                    )}
                    {status === "cards" && (
                        <Button size="sm" variant="ghost" onClick={onBackToChat}>
                            Чат
                        </Button>
                    )}
                </div>
            </div>

            <div className="review-sidebar-body">
                {status === "expertise" ? (
                    <div className="review-chat-flow">
                        <div className="review-chat-scroll">
                            {expertise && (
                                <article className="review-chat-expert">
                                    <div className="review-chat-bubble">
                                        <ReactMarkdown>{expertise}</ReactMarkdown>
                                    </div>
                                </article>
                            )}
                            {history.map((msg) => (
                                <article key={msg.id} className={`review-chat-msg review-chat-msg-${msg.role}`}>
                                    <div className="review-chat-bubble">
                                        <p>{msg.content}</p>
                                    </div>
                                </article>
                            ))}
                            <div ref={chatEndRef} />
                        </div>

                        <div className="review-chat-input">
                            <textarea
                                className="review-chat-textarea"
                                placeholder="Запитати або уточнити..."
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                            />
                            <Button variant="secondary" size="sm" onClick={handleSend} disabled={!inputText.trim() || reviewLoading}>
                                Сказати
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="operations-stack operations-stack-compact">
                        {reviewItems.filter(i => i.status !== 'dismissed').map((item) => (
                            <EditorialReviewCard
                                key={item.id}
                                item={item}
                                revision={revision}
                                isActive={item.id === activeReviewItemId}
                                onFocus={onFocusReviewItem}
                                onPrepare={onPrepareReviewItem}
                                onApplyCallout={onApplyCallout}
                                onDismiss={onDismissReviewItem}
                            />
                        ))}
                        {reviewItems.filter(i => i.status !== 'dismissed').length === 0 && !reviewLoading && (
                            <div className="operations-empty">
                                <p className="editor-note-copy">Правки не сформовані або всі відхилені.</p>
                            </div>
                        )}
                    </div>
                )}

                {reviewLoading && (
                    <div className="loading-state-card" style={{ padding: '20px', textAlign: 'center' }}>
                        <span className="loading-inline-dots">
                            <span /><span /><span />
                        </span>
                        <p className="mono-ui" style={{ marginTop: '10px' }}>Працюю...</p>
                    </div>
                )}
            </div>
        </div>
    );
}
