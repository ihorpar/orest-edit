import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ReviewSessionStatus, WholeTextChangeLevel } from "../../lib/editor/review-contract";
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

                <div className="review-sidebar-body" style={{ height: "calc(100vh - 61px)", overflowY: "auto", display: "flex", flexDirection: "column" }}>
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
                                <Button variant="primary" onClick={onAnalyze} loading={reviewLoading}>Запустити експертизу</Button>
                            </div>
                        </div>
                    ) : (
                        <div className="review-analysis-display" style={{ padding: '24px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <div style={{ flex: 1, paddingBottom: '20px' }}>
                                {expertiseForDisplay && (
                                    <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--ink)' }}>
                                        <ReactMarkdown>{expertiseForDisplay}</ReactMarkdown>
                                    </div>
                                )}
                                {reviewLoading && !expertiseForDisplay && (
                                    <div style={{ marginTop: '20px' }}>
                                        <span className="loading-inline-dots"><span /><span /><span /></span>
                                    </div>
                                )}
                            </div>

                            <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid var(--porcelain)' }}>
                                {status === "cards" && !reviewLoading ? (
                                    <div style={{ padding: '20px', background: '#f0fdf4', borderRadius: '6px', textAlign: 'center', border: '1px solid #bbf7d0' }}>
                                        <p style={{ margin: '0 0 12px 0', fontWeight: 500, color: '#166534' }}>Етап завершено. Картки згенеровано.</p>
                                        <Button variant="primary" onClick={onClose}>Перейти до карток</Button>
                                    </div>
                                ) : (
                                    <>
                                        <textarea
                                            placeholder="Коментар до експертизи (опційно): що залишити, що переформулювати, на чому сфокусувати картки."
                                            value={inputText}
                                            onChange={(e) => setInputText(e.target.value)}
                                            style={{ width: '100%', minHeight: '80px', padding: '12px', border: '1px solid #eef2f7', borderRadius: '6px', resize: 'vertical', fontSize: '13px', background: '#f8fafc' }}
                                            disabled={reviewLoading}
                                        />
                                        <div className="button-row" style={{ justifyContent: "flex-end", marginTop: '12px' }}>
                                            <Button variant="primary" onClick={() => onGenerateCards(inputText)} loading={reviewLoading} disabled={!canGenerateCards}>
                                                Згенерувати картки
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
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
  illustration: "візуал",
  mechanism: "механізм",
  analogy: "аналогія",
  everyday_application: "практичне застосування",
  myths_vs_truth: "міфи та правда",
  top_list: "топ-список",
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
