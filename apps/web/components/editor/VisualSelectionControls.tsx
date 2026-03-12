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
        <defs>
          <linearGradient id="intent-ill-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#C084FC" />
            <stop offset="100%" stopColor="#818CF8" />
          </linearGradient>
        </defs>
        <rect x="2" y="3" width="20" height="18" rx="4" fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4 17 L8 12 L12 16 L17 9 L20 13" stroke="url(#intent-ill-grad)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="7" r="2.5" fill="#FDE047" stroke="currentColor" strokeWidth="0.5" />
        <rect x="5" y="6" width="6" height="1.5" rx="0.75" fill="currentColor" fillOpacity="0.3" />
        <rect x="5" y="9" width="4" height="1.5" rx="0.75" fill="currentColor" fillOpacity="0.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="intent-info-grad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#60A5FA" />
        </linearGradient>
      </defs>
      <rect x="2" y="3" width="20" height="18" rx="4" fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5" y="14" width="3" height="4" rx="1" fill="url(#intent-info-grad)" />
      <rect x="9" y="10" width="3" height="8" rx="1" fill="url(#intent-info-grad)" fillOpacity="0.8" />
      <rect x="13" y="12" width="3" height="6" rx="1" fill="url(#intent-info-grad)" fillOpacity="0.6" />
      <rect x="17" y="8" width="3" height="10" rx="1" fill="url(#intent-info-grad)" fillOpacity="0.4" />
      <path d="M5 7 H 15 M5 10 H 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

function VisualStyleIcon({ preset }: { preset: VisualStylePreset }) {
  switch (preset) {
    case "minimal":
      return (
        <svg viewBox="0 0 96 64" fill="none">
          <defs>
            <filter id="vs1-min-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#94A3B8" floodOpacity="0.15" />
            </filter>
            <linearGradient id="vs1-min-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#F8FAFC" />
              <stop offset="100%" stopColor="#F1F5F9" />
            </linearGradient>
          </defs>
          <rect x="6" y="6" width="84" height="52" rx="10" fill="url(#vs1-min-grad)" stroke="#E2E8F0" strokeWidth="1.5" />
          <rect x="20" y="16" width="32" height="32" rx="8" fill="#FFFFFF" filter="url(#vs1-min-shadow)" />
          <circle cx="36" cy="32" r="6" fill="#F1F5F9" stroke="#94A3B8" strokeWidth="1.5" />
          <path d="M62 24 H 74 M62 32 H 78 M62 40 H 70" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
          <circle cx="28" cy="24" r="3" fill="#3B82F6" />
        </svg>
      );
    case "neo_brutal":
      return (
        <svg viewBox="0 0 96 64" fill="none">
          <defs>
            <pattern id="vs2-brutal-dots" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="#94A3B8" opacity="0.3" />
            </pattern>
          </defs>
          <rect x="6" y="6" width="84" height="52" rx="8" fill="#F8FAFC" stroke="#0F172A" strokeWidth="2.5" />
          <rect x="6" y="6" width="84" height="52" rx="8" fill="url(#vs2-brutal-dots)" />
          <rect x="24" y="20" width="56" height="32" rx="4" fill="#0F172A" />
          <rect x="20" y="16" width="56" height="32" rx="4" fill="#FDE047" stroke="#0F172A" strokeWidth="2.5" />
          <path d="M28 24 L36 24 L36 32 L28 32 Z" fill="#A855F7" stroke="#0F172A" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="44" cy="28" r="5" fill="#10B981" stroke="#0F172A" strokeWidth="2" />
          <rect x="54" y="24" width="16" height="4" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          <rect x="54" y="32" width="10" height="4" fill="#EC4899" stroke="#0F172A" strokeWidth="1.5" />
          <rect x="28" y="40" width="40" height="4" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
        </svg>
      );
    case "modern_glass":
      return (
        <svg viewBox="0 0 96 64" fill="none">
          <defs>
            <radialGradient id="vs3-glass-grad1" cx="30%" cy="30%" r="60%">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="vs3-glass-grad2" cx="80%" cy="80%" r="60%">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="vs3-glass-grad3" cx="70%" cy="20%" r="50%">
              <stop offset="0%" stopColor="#EC4899" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#EC4899" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="vs3-glass-panel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.05" />
            </linearGradient>
            <filter id="vs3-glass-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="blur" />
            </filter>
          </defs>
          <rect x="6" y="6" width="84" height="52" rx="12" fill="#0F172A" />
          <circle cx="32" cy="24" r="22" fill="url(#vs3-glass-grad1)" filter="url(#vs3-glass-blur)" />
          <circle cx="72" cy="46" r="20" fill="url(#vs3-glass-grad2)" filter="url(#vs3-glass-blur)" />
          <circle cx="68" cy="18" r="16" fill="url(#vs3-glass-grad3)" filter="url(#vs3-glass-blur)" />
          <rect x="16" y="14" width="64" height="36" rx="10" fill="url(#vs3-glass-panel)" stroke="#FFFFFF" strokeWidth="1" strokeOpacity="0.25" />
          <rect x="24" y="22" width="20" height="20" rx="6" fill="#FFFFFF" fillOpacity="0.15" stroke="#FFFFFF" strokeWidth="1" strokeOpacity="0.2" />
          <path d="M26 26 C 28 24, 38 24, 42 28" fill="none" stroke="#FFFFFF" strokeOpacity="0.4" strokeWidth="1" />
          <path d="M52 26 H 70 M52 32 H 68 M52 38 H 62" stroke="#FFFFFF" strokeWidth="2" strokeOpacity="0.7" strokeLinecap="round" />
          <circle cx="70" cy="38" r="2" fill="#FFFFFF" fillOpacity="0.8" />
        </svg>
      );
    case "calm_gradient":
    default:
      return (
        <svg viewBox="0 0 96 64" fill="none">
          <defs>
            <linearGradient id="vs4-calm-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#E0F2FE" />
              <stop offset="50%" stopColor="#EDE9FE" />
              <stop offset="100%" stopColor="#FAE8FF" />
            </linearGradient>
            <linearGradient id="vs4-calm-blob1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#C084FC" />
              <stop offset="100%" stopColor="#F472B6" />
            </linearGradient>
            <linearGradient id="vs4-calm-blob2" x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7DD3FC" />
              <stop offset="100%" stopColor="#38BDF8" />
            </linearGradient>
            <filter id="vs4-calm-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#8B5CF6" floodOpacity="0.15" />
            </filter>
            <filter id="vs4-soft-blur">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <filter id="vs4-soft-blur-sm">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <rect x="6" y="6" width="84" height="52" rx="12" fill="url(#vs4-calm-bg)" stroke="#FFFFFF" strokeWidth="2" />
          <circle cx="28" cy="24" r="18" fill="url(#vs4-calm-blob1)" opacity="0.6" filter="url(#vs4-soft-blur)" />
          <circle cx="72" cy="42" r="16" fill="url(#vs4-calm-blob2)" opacity="0.6" filter="url(#vs4-soft-blur)" />
          <circle cx="68" cy="18" r="12" fill="#FDE047" opacity="0.5" filter="url(#vs4-soft-blur-sm)" />
          <rect x="20" y="20" width="56" height="24" rx="8" fill="#FFFFFF" fillOpacity="0.85" stroke="#FFFFFF" strokeWidth="2" filter="url(#vs4-calm-shadow)" />
          <path d="M28 28 H 68 M28 36 H 54" stroke="#64748B" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
  }
}
