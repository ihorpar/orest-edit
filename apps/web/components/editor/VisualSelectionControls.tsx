"use client";

import type { EditorialVisualIntent, VisualStylePreset } from "../../lib/editor/review-contract";

export function VisualIntentToggle({
  value,
  options,
  onChange,
  disabled = false
}: {
  value: EditorialVisualIntent;
  options: Array<{ value: EditorialVisualIntent; label: string }>;
  onChange: (value: EditorialVisualIntent) => void;
  disabled?: boolean;
}) {
  return (
    <div className="editorial-review-visual-intent-toggle" role="tablist" aria-label="Тип візуалу">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className="editorial-review-visual-intent-button"
          data-active={value === option.value ? "true" : "false"}
          onClick={() => onChange(option.value)}
          disabled={disabled}
        >
          <span className="editorial-review-visual-intent-icon" aria-hidden="true">
            <VisualIntentIcon intent={option.value} />
          </span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function VisualStyleToggle({
  value,
  options,
  onChange,
  disabled = false
}: {
  value: VisualStylePreset;
  options: Array<{ value: VisualStylePreset; label: string }>;
  onChange: (value: VisualStylePreset) => void;
  disabled?: boolean;
}) {
  return (
    <div className="editorial-review-visual-style-grid" role="radiogroup" aria-label="Стиль візуалу">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="editorial-review-visual-style-button"
          data-active={value === option.value ? "true" : "false"}
          onClick={() => onChange(option.value)}
          disabled={disabled}
        >
          <span className="editorial-review-visual-style-icon" aria-hidden="true">
            <VisualStyleIcon preset={option.value} />
          </span>
          <span className="editorial-review-visual-style-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function VisualIntentIcon({ intent }: { intent: EditorialVisualIntent }) {
  if (intent === "illustration") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="4.2" stroke="currentColor" strokeWidth="1.6" />
        <rect x="5.4" y="6.4" width="13.2" height="11.2" rx="2.6" fill="currentColor" fillOpacity="0.08" />
        <circle cx="16.8" cy="8.6" r="1.25" fill="currentColor" />
        <path
          d="M6.8 15.9L10.2 12.6L12.8 14.8L15.1 12.4L18 15.2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M6.7 16.1H17.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="4.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="5.4" y="6.4" width="13.2" height="11.2" rx="2.6" fill="currentColor" fillOpacity="0.08" />
      <path d="M7 8.6H13.4" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M7 11.6H12.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M7 14.6H10.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <rect x="14.1" y="8.2" width="2.4" height="7.7" rx="1.2" fill="currentColor" fillOpacity="0.94" />
      <rect x="17.1" y="10.2" width="2.2" height="5.7" rx="1.1" fill="currentColor" fillOpacity="0.62" />
    </svg>
  );
}

function VisualStyleIcon({ preset }: { preset: VisualStylePreset }) {
  switch (preset) {
    case "minimal":
      return (
        <svg viewBox="0 0 96 64" fill="none">
          <rect x="8" y="9" width="80" height="46" rx="10" fill="#F8FAFC" stroke="#CBD5E1" />
          <rect x="14" y="15" width="68" height="34" rx="7" fill="#FFFFFF" stroke="#E2E8F0" />
          <path d="M20 22H74" stroke="#64748B" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M20 30H62" stroke="#94A3B8" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M20 38H56" stroke="#B0BDCF" strokeWidth="2.1" strokeLinecap="round" />
          <rect x="20" y="42" width="18" height="4.8" rx="2.4" fill="#E2E8F0" />
        </svg>
      );
    case "neo_brutal":
      return (
        <svg viewBox="0 0 96 64" fill="none">
          <rect x="12" y="13" width="76" height="42" rx="8" fill="#0F172A" fillOpacity="0.18" />
          <rect x="8" y="9" width="76" height="42" rx="8" fill="#F8FAFC" stroke="#111827" strokeWidth="3" />
          <rect x="16" y="15" width="21" height="28" fill="#FDE047" stroke="#111827" strokeWidth="2.8" />
          <rect x="41" y="15" width="35" height="12" fill="#60A5FA" stroke="#111827" strokeWidth="2.8" />
          <rect x="41" y="31" width="19" height="12" fill="#FB7185" stroke="#111827" strokeWidth="2.8" />
          <rect x="63" y="31" width="13" height="12" fill="#A78BFA" stroke="#111827" strokeWidth="2.8" />
        </svg>
      );
    case "modern_glass":
      return (
        <svg viewBox="0 0 96 64" fill="none">
          <rect x="8" y="9" width="80" height="46" rx="12" fill="#E8EEF8" />
          <rect x="16" y="15" width="35" height="30" rx="11" fill="#FFFFFF" fillOpacity="0.6" stroke="#C6D4EA" />
          <rect x="38" y="21" width="42" height="25" rx="11" fill="#F8FBFF" fillOpacity="0.66" stroke="#B9CBE6" />
          <path d="M23 20H46" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.8" />
          <path d="M43 29H70" stroke="#A7B6CE" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M23 34H47" stroke="#A7B6CE" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="60" cy="35" r="8" fill="#DBEAFE" fillOpacity="0.44" />
        </svg>
      );
    case "calm_gradient":
    default:
      return (
        <svg viewBox="0 0 96 64" fill="none">
          <rect x="8" y="9" width="80" height="46" rx="12" fill="#DEE7FF" />
          <circle cx="33" cy="24" r="18" fill="#BFE4FF" fillOpacity="0.9" />
          <circle cx="59" cy="37" r="18" fill="#C7B5FF" fillOpacity="0.86" />
          <circle cx="48" cy="28" r="15" fill="#A5F3FC" fillOpacity="0.35" />
          <rect x="22" y="22" width="52" height="20" rx="8" fill="#FFFFFF" fillOpacity="0.66" stroke="#B8D3FF" />
          <path d="M28 30H66" stroke="#7F97BF" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M28 34H53" stroke="#8EA6CC" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}
