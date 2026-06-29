"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ReviewSessionStatus, WholeTextChangeLevel } from "../../lib/editor/review-contract";
import type { AppLocale } from "../../lib/i18n/product-locale";
import type { EditorMessages } from "../../lib/i18n/editor-messages";
import { useProductCopy, useProductLocale } from "../providers/ProductLocaleProvider";
import { Button } from "../ui/Button";

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
    onResetExpertise,
    onClose,
    onScrollToBlockIndex
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
    onResetExpertise: () => void;
    onClose: () => void;
    onScrollToBlockIndex?: (index: number) => void;
}) {
    const copy = useProductCopy();
    const { locale } = useProductLocale();
    const drawer = copy.editor.reviewDrawer;
    const [inputText, setInputText] = useState("");
    const hasExpertise = Boolean(expertise?.trim());
    const isSetup = status === "expertise" && !hasExpertise;
    const canGenerateCards = hasExpertise && !reviewLoading;
    const expertiseForDisplay = useMemo(
        () => (expertise ? localizeExpertiseMarkdown(expertise, locale, drawer) : null),
        [drawer, expertise, locale]
    );

    if (!isOpen) return null;

    return (
        <div className="review-drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="review-drawer">
                <header className="review-drawer-head">
                    <h2 className="review-drawer-title">{drawer.title}</h2>
                    <button type="button" className="panel-toggle" onClick={onClose} aria-label={drawer.close} title={drawer.close}>
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
                        {drawer.stageExpertise}
                    </button>
                    <button
                        type="button"
                        className="review-stage-button"
                        data-active={status === "cards" ? "true" : "false"}
                        onClick={() => onGenerateCards(inputText)}
                        disabled={!canGenerateCards}
                    >
                        {drawer.stageCards}
                    </button>
                </div>

                <div className="review-sidebar-body">
                    <div className="review-scroll-content">
                        <p className="review-stage-copy">
                            {status === "cards"
                                ? drawer.stageCardsDone
                                : hasExpertise
                                    ? drawer.stageExpertiseDone
                                    : drawer.stageExpertiseIdle}
                        </p>

                        {isSetup ? (
                            <div className="review-drawer-setup">
                                <p className="mono-ui">{drawer.setupTitle}</p>
                                <div className="review-level-cards">
                                    {drawer.reviewLevels.map((option) => (
                                        <button
                                            key={option.level}
                                            type="button"
                                            className="review-level-card"
                                            data-active={reviewChangeLevel === option.level ? "true" : "false"}
                                            onClick={() => onReviewChangeLevel(option.level)}
                                        >
                                            <div className="review-level-card-number">{option.level}</div>
                                            <div className="review-level-card-label">{option.description}</div>
                                        </button>
                                    ))}
                                </div>

                                <div className="floating-textarea-shell">
                                    <textarea
                                        className="floating-textarea"
                                        rows={4}
                                        placeholder={drawer.additionalInstructionsPlaceholder}
                                        value={reviewAdditionalInstructions}
                                        onChange={(e) => onReviewAdditionalInstructionsChange(e.target.value)}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="review-analysis-display">
                                <div className="analysis-text-wrapper">
                                    {expertiseForDisplay && (
                                        <div style={{ fontSize: '14.5px', lineHeight: 1.6, color: '#1a1a1b' }}>
                                            <ReactMarkdown
                                                components={{
                                                    a: ({ href, children }) => {
                                                        if (href?.startsWith("#block-")) {
                                                            const idx = parseInt(href.replace("#block-", ""), 10);
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    style={{
                                                                        color: "var(--surgical-blue)",
                                                                        textDecoration: "underline",
                                                                        textDecorationColor: "#cbd5e1",
                                                                        background: "none",
                                                                        border: "none",
                                                                        padding: 0,
                                                                        font: "inherit",
                                                                        cursor: "pointer"
                                                                    }}
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        if (onScrollToBlockIndex) onScrollToBlockIndex(idx);
                                                                    }}
                                                                >
                                                                    {children}
                                                                </button>
                                                            );
                                                        }
                                                        return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
                                                    }
                                                }}
                                            >
                                                {expertiseForDisplay}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                    {reviewLoading && !expertiseForDisplay && (
                                        <div className="analysis-loading">
                                            <span className="loading-inline-dots"><span /><span /><span /></span>
                                            <p style={{ marginTop: '12px', fontSize: '13px', color: 'var(--muted)' }}>{drawer.analyzing}</p>
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
                            {drawer.runExpertise}
                        </Button>
                    ) : (
                        <div style={{ width: '100%' }}>
                            {status === "cards" && !reviewLoading ? (
                                <div className="review-success-panel">
                                    <p className="success-message">
                                        {reviewItemsCount > 0
                                            ? drawer.cardsGenerated(reviewItemsCount, pluralizeCards(reviewItemsCount, drawer))
                                            : drawer.stageComplete}
                                    </p>
                                    <Button variant="primary" onClick={onClose} style={{ width: '100%' }}>{drawer.goToCards}</Button>
                                </div>
                            ) : (
                                <div className="generate-cards-controls">
                                    <textarea
                                        className="review-comment-textarea"
                                        placeholder={drawer.expertiseCommentPlaceholder}
                                        value={inputText}
                                        onChange={(e) => setInputText(e.target.value)}
                                        disabled={reviewLoading}
                                    />
                                    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                        <Button variant="secondary" onClick={onResetExpertise} disabled={reviewLoading}>
                                            {drawer.newExpertise}
                                        </Button>
                                        <Button variant="primary" onClick={() => onGenerateCards(inputText)} loading={reviewLoading} disabled={!canGenerateCards}>
                                            {drawer.generateCards}
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

function localizeExpertiseMarkdown(
    value: string,
    locale: AppLocale,
    drawer: EditorMessages["reviewDrawer"]
): string {
    let next = value.replace(/\r\n?/g, "\n");
    const fieldLabels = drawer.expertiseFieldLabels;

    next = next
        .replace(/Suggested Action\s*:/gi, fieldLabels.suggestedAction)
        .replace(/Callout Kind\s*:/gi, fieldLabels.calloutKind)
        .replace(/Visual Intent\s*:/gi, fieldLabels.visualIntent)
        .replace(/Recommendation\s*:/gi, fieldLabels.recommendation)
        .replace(/What doesn't work\s*:/gi, fieldLabels.whatDoesntWork);

    for (const [token, label] of Object.entries(drawer.expertiseTokens)) {
        const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi");
        next = next.replace(pattern, label);
    }

    const paragraphPattern = locale === "en"
        ? /(?:para\.|paragraph|p\.)\s*0*(\d+)(?:\s*-\s*0*(\d+))?/gi
        : /абз\.\s*0*(\d+)(?:\s*-\s*0*(\d+))?/gi;

    next = next.replace(paragraphPattern, (match, p1) => {
        const idx = parseInt(p1, 10);
        if (isNaN(idx)) return match;
        return `[${match}](#block-${idx - 1})`;
    });

    return next;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pluralizeCards(count: number, drawer: EditorMessages["reviewDrawer"]): string {
    if (drawer.cardsWordFew === drawer.cardsWordMany) {
        return count === 1 ? drawer.cardsWordOne : drawer.cardsWordMany;
    }

    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return drawer.cardsWordOne;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return drawer.cardsWordFew;
    return drawer.cardsWordMany;
}
