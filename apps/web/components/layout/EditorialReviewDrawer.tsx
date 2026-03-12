import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ReviewSessionStatus, WholeTextChangeLevel } from "../../lib/editor/review-contract";
import { Button } from "../ui/Button";

const reviewLevelOptions: Array<{ level: WholeTextChangeLevel; label: string; description: string }> = [
    { level: 1, label: "1", description: "Легкий марафет" },
    { level: 2, label: "2", description: "Трохи підчистити" },
    { level: 3, label: "3", description: "Добряче пройтись" },
    { level: 4, label: "4", description: "Розібрати на гвинтики" },
    { level: 5, label: "5", description: "Згорів сарай — гори хата" }
];

export function EditorialReviewDrawer({
    isOpen,
    status,
    expertise,
    reviewItemsCount,
    reviewLoading,
    reviewChangeLevel,
    reviewAdditionalInstructions,
    onReviewChangeLevel,
    onReviewAdditionalInstructionsChange,
    onAnalyze,
    onGenerateCards,
    onClose
}: {
    isOpen: boolean;
    status: ReviewSessionStatus;
    expertise: string | null;
    reviewItemsCount: number;
    reviewLoading?: boolean;
    reviewChangeLevel: WholeTextChangeLevel;
    reviewAdditionalInstructions: string;
    onReviewChangeLevel: (level: WholeTextChangeLevel) => void;
    onReviewAdditionalInstructionsChange: (value: string) => void;
    onAnalyze: () => void;
    onGenerateCards: (feedback: string) => void;
    onClose: () => void;
}) {
    const [inputText, setInputText] = useState("");
    const hasExpertise = Boolean(expertise?.trim());
    const isSetup = status === "expertise" && !hasExpertise;
    const canGenerateCards = hasExpertise && !reviewLoading;
    const expertiseForDisplay = useMemo(
        () => (expertise ? localizeExpertiseMarkdown(expertise) : null),
        [expertise]
    );

    if (!isOpen) return null;

    return (
        <div className="review-drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="review-drawer">
                <header className="review-drawer-head">
                    <h2 className="review-drawer-title">Експертиза документа</h2>
                    <button type="button" className="panel-toggle" onClick={onClose} aria-label="Закрити" title="Закрити">
                        ×
                    </button>
                </header>

                <div className="review-stage-controls">
                    <button
                        type="button"
                        className="review-stage-button"
                        data-active={status === "expertise" ? "true" : "false"}
                        onClick={onAnalyze}
                        disabled={reviewLoading}
                    >
                        1. Експертиза
                    </button>
                    <button
                        type="button"
                        className="review-stage-button"
                        data-active={status === "cards" ? "true" : "false"}
                        onClick={() => onGenerateCards(inputText)}
                        disabled={!canGenerateCards}
                    >
                        2. Картки
                    </button>
                </div>

                <div className="review-sidebar-body">
                    <div className="review-scroll-content">
                        <p className="review-stage-copy">
                            {status === "cards"
                                ? "Етап 2 з 2: картки згенеровано."
                                : hasExpertise
                                    ? "Етап 1 з 2 завершено. Додайте коментар (за потреби) і згенеруйте картки."
                                    : "Етап 1 з 2: запустіть експертизу документа."}
                        </p>

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
                                <p className="floating-review-description">
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
                            </div>
                        ) : (
                            <div className="review-analysis-display">
                                <div className="analysis-text-wrapper">
                                    {expertiseForDisplay && (
                                        <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--ink)' }}>
                                            <ReactMarkdown>{expertiseForDisplay}</ReactMarkdown>
                                        </div>
                                    )}
                                    {reviewLoading && !expertiseForDisplay && (
                                        <div className="analysis-loading">
                                            <span className="loading-inline-dots"><span /><span /><span /></span>
                                            <p style={{ marginTop: '12px', fontSize: '13px', color: 'var(--muted)' }}>ШІ аналізує документ...</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <footer className="review-drawer-footer">
                    {isSetup ? (
                        <Button variant="primary" onClick={onAnalyze} loading={reviewLoading} style={{ width: '100%' }}>
                            Запустити експертизу
                        </Button>
                    ) : (
                        <div style={{ width: '100%' }}>
                            {status === "cards" && !reviewLoading ? (
                                <div className="review-success-panel">
                                    <p className="success-message">
                                        {reviewItemsCount > 0
                                            ? `Згенеровано ${reviewItemsCount} ${pluralizeCards(reviewItemsCount)}.`
                                            : "Етап завершено. Картки згенеровано."}
                                    </p>
                                    <Button variant="primary" onClick={onClose} style={{ width: '100%' }}>Перейти до карток</Button>
                                </div>
                            ) : (
                                <div className="generate-cards-controls">
                                    <textarea
                                        className="review-comment-textarea"
                                        placeholder="Коментар до експертизи (опційно): що залишити, що переформулювати..."
                                        value={inputText}
                                        onChange={(e) => setInputText(e.target.value)}
                                        disabled={reviewLoading}
                                    />
                                    <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                                        <Button variant="primary" onClick={() => onGenerateCards(inputText)} loading={reviewLoading} disabled={!canGenerateCards}>
                                            Згенерувати картки
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </footer>
            </div>
        </div>
    );

}

const expertiseTokenMap: Record<string, string> = {
    rewrite_text: "переписати фрагмент",
    insert_text: "додати вставку",
    prepare_callout: "підготувати врізку",
    prepare_visual: "підготувати візуал",
    rewrite: "переписати",
    simplify: "спростити",
    expand: "розширити",
    list: "оформити списком",
    subsection: "додати підзаголовок",
    callout: "врізка",
    visual: "візуал",
    visualize: "візуал",
    mechanism: "механізм",
    analogy: "аналогія",
    everyday_application: "практичне застосування",
    myths_vs_truth: "міфи та правда",
    top_list: "топ-список",
    infographic: "інфографіка",
    illustration: "ілюстрація",
    diagram: "схема",
    comparison: "порівняння",
    process: "процес",
    timeline: "таймлайн",
    scene: "сцена",
    concept: "концепт",
    mechanism_explained: "механізм"
};

function localizeExpertiseMarkdown(value: string): string {
    let next = value.replace(/\r\n?/g, "\n");

    next = next
        .replace(/Suggested Action\s*:/gi, "Рекомендована дія:")
        .replace(/Callout Kind\s*:/gi, "Тип врізки:")
        .replace(/Visual Intent\s*:/gi, "Тип візуалу:")
        .replace(/Recommendation\s*:/gi, "Рекомендація:")
        .replace(/What doesn't work\s*:/gi, "Що не працює:");

    for (const [token, label] of Object.entries(expertiseTokenMap)) {
        const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi");
        next = next.replace(pattern, label);
    }

    return next;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pluralizeCards(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "картку";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "картки";
    return "карток";
}
