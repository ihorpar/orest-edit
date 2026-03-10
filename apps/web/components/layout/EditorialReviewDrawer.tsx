import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import type { ChatMessage, ReviewSessionStatus, WholeTextChangeLevel } from "../../lib/editor/review-contract";
import { Button } from "../ui/Button";

const reviewLevelOptions: Array<{ level: WholeTextChangeLevel; label: string; description: string }> = [
    { level: 1, label: "1", description: "Мінімальні зауваги" },
    { level: 2, label: "2", description: "Легке шліфування" },
    { level: 3, label: "3", description: "Помірне редакторське втручання" },
    { level: 4, label: "4", description: "Суттєве перепакування" },
    { level: 5, label: "5", description: "Максимально глибокий огляд" }
];

export function EditorialReviewDrawer({
    isOpen,
    status,
    expertise,
    history,
    reviewLoading,
    reviewChangeLevel,
    reviewAdditionalInstructions,
    onReviewChangeLevel,
    onReviewAdditionalInstructionsChange,
    onAnalyze,
    onChat,
    onGenerateCards,
    onClose
}: {
    isOpen: boolean;
    status: ReviewSessionStatus;
    expertise: string | null;
    history: ChatMessage[];
    reviewLoading?: boolean;
    reviewChangeLevel: WholeTextChangeLevel;
    reviewAdditionalInstructions: string;
    onReviewChangeLevel: (level: WholeTextChangeLevel) => void;
    onReviewAdditionalInstructionsChange: (value: string) => void;
    onAnalyze: () => void;
    onChat: (message: string) => void;
    onGenerateCards: () => void;
    onClose: () => void;
}) {
    const [inputText, setInputText] = useState("");
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [history, expertise, isOpen]);

    if (!isOpen) return null;

    const handleSend = () => {
        if (!inputText.trim()) return;
        onChat(inputText.trim());
        setInputText("");
    };

    const isSetup = status === "expertise" && !expertise && history.length === 0;

    return (
        <div className="review-drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="review-drawer">
                <header className="review-drawer-head">
                    <h2 className="review-drawer-title">Експертиза документа</h2>
                    <button type="button" className="panel-toggle" onClick={onClose} aria-label="Закрити" title="Закрити">
                        ×
                    </button>
                </header>

                <div className="review-sidebar-body" style={{ height: "calc(100vh - 61px)" }}>
                    {isSetup ? (
                        <div className="review-drawer-setup">
                            <p className="mono-ui">Налаштування перевірки</p>
                            <div className="floating-review-scale">
                                {reviewLevelOptions.map((option) => (
                                    <button
                                        key={option.level}
                                        type="button"
                                        className="floating-review-scale-button"
                                        data-active={reviewChangeLevel === option.level ? "true" : "false"}
                                        onClick={() => onReviewChangeLevel(option.level)}
                                    >
                                        <span className="mono-ui">{option.label}</span>
                                    </button>
                                ))}
                            </div>
                            <p className="floating-review-description" style={{ marginTop: 0 }}>
                                {reviewLevelOptions.find((option) => option.level === reviewChangeLevel)?.description}
                            </p>

                            <div className="floating-textarea-shell">
                                <textarea
                                    className="floating-textarea"
                                    rows={4}
                                    placeholder="Додаткові інструкції (напр. 'перевір чи немає тавтології', 'зроби більш емоційно')"
                                    value={reviewAdditionalInstructions}
                                    onChange={(e) => onReviewAdditionalInstructionsChange(e.target.value)}
                                />
                            </div>

                            <div style={{ marginTop: "16px" }}>
                                <Button variant="primary" onClick={onAnalyze} loading={reviewLoading}>Аналіз ШІ</Button>
                            </div>
                        </div>
                    ) : (
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
                                {reviewLoading && (
                                    <article className="review-chat-msg review-chat-msg-assistant">
                                        <div className="review-chat-bubble">
                                            <span className="loading-inline-dots">
                                                <span /><span /><span />
                                            </span>
                                        </div>
                                    </article>
                                )}
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
                                <div className="button-row" style={{ justifyContent: "space-between" }}>
                                    <Button variant="secondary" size="sm" onClick={handleSend} disabled={!inputText.trim() || reviewLoading}>
                                        Сказати
                                    </Button>
                                    <Button variant="primary" size="sm" onClick={onGenerateCards} disabled={reviewLoading}>
                                        Перейти до карток
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
