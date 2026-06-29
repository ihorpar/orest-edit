export type AppLocale = "uk" | "en";
export type ProductDisplayLocale = "uk-UA" | "en-US";

export interface ProductLocaleConfig {
  appLocale: AppLocale;
  displayLocale: ProductDisplayLocale;
  spellcheckLanguage: ProductDisplayLocale;
  docxLanguage: ProductDisplayLocale;
  storageSuffix: AppLocale;
  defaultFileNameBase: string;
  paragraphShortLabel: string;
}

export const APP_LOCALE_UPDATED_EVENT = "orest-app-locale-updated";
export const ACTIVE_APP_LOCALE_STORAGE_KEY = "orest-active-locale-v1";

const DEFAULT_LOCALE_CONFIGS: Record<AppLocale, ProductLocaleConfig> = {
  uk: {
    appLocale: "uk",
    displayLocale: "uk-UA",
    spellcheckLanguage: "uk-UA",
    docxLanguage: "uk-UA",
    storageSuffix: "uk",
    defaultFileNameBase: "Рукопис",
    paragraphShortLabel: "Абз."
  },
  en: {
    appLocale: "en",
    displayLocale: "en-US",
    spellcheckLanguage: "en-US",
    docxLanguage: "en-US",
    storageSuffix: "en",
    defaultFileNameBase: "Manuscript",
    paragraphShortLabel: "Para."
  }
};

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "uk" || value === "en";
}

export function getConfiguredAppLocale(): AppLocale {
  const value =
    process.env.NEXT_PUBLIC_OREST_APP_LOCALE
    ?? process.env.OREST_APP_LOCALE
    ?? "";

  return isAppLocale(value) ? value : "uk";
}

export function getDefaultAppLocale(): AppLocale {
  return getConfiguredAppLocale();
}

export function readActiveAppLocale(): AppLocale {
  if (typeof window === "undefined") {
    return getDefaultAppLocale();
  }

  try {
    const raw = window.localStorage.getItem(ACTIVE_APP_LOCALE_STORAGE_KEY);
    return isAppLocale(raw) ? raw : getDefaultAppLocale();
  } catch {
    return getDefaultAppLocale();
  }
}

export function writeActiveAppLocale(locale: AppLocale): AppLocale {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(ACTIVE_APP_LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore localStorage failures.
    }
  }

  return locale;
}

export function getProductLocaleConfig(locale: AppLocale = getDefaultAppLocale()): ProductLocaleConfig {
  return DEFAULT_LOCALE_CONFIGS[locale];
}

export function getLocaleStorageSuffix(locale: AppLocale): AppLocale {
  return getProductLocaleConfig(locale).storageSuffix;
}

export function getEditorSettingsStorageKey(locale: AppLocale): string {
  return `orest-editor-settings-${getLocaleStorageSuffix(locale)}-v1`;
}

export function getLegacyEditorSettingsStorageKey(): string {
  return "orest-editor-settings-v1";
}

export function getEditorDraftStorageKey(locale: AppLocale): string {
  return `orest-editor-draft-${getLocaleStorageSuffix(locale)}-v3`;
}

export function getLegacyEditorDraftStorageKeys(): string[] {
  return ["orest-editor-draft-v3", "orest-editor-draft-v2", "orest-editor-draft-v1"];
}

export function getVisualStylePresetStorageKey(locale: AppLocale): string {
  return `orest-visual-style-${getLocaleStorageSuffix(locale)}-v1`;
}

export function getLegacyVisualStylePresetStorageKey(): string {
  return "orest-visual-style-v1";
}

export function getSpellcheckDictionaryDbName(locale: AppLocale): string {
  return `orest-spellcheck-dictionary-${getLocaleStorageSuffix(locale)}-v1`;
}

export function getLegacySpellcheckDictionaryDbName(): string {
  return "orest-spellcheck-dictionary-v1";
}

export function getEditorAssetStorageKey(locale: AppLocale): string {
  return `orest-editor-assets-${getLocaleStorageSuffix(locale)}-v1`;
}

export function getLegacyEditorAssetStorageKey(): string {
  return "orest-editor-assets-v1";
}

export function formatLocalizedNumber(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(getProductLocaleConfig(locale).displayLocale).format(value);
}

export function formatParagraphRangeLabel(locale: AppLocale, startLabel: string, endLabel?: string): string {
  const prefix = getProductLocaleConfig(locale).paragraphShortLabel;

  if (!endLabel || endLabel === startLabel) {
    return `${prefix} ${startLabel}`;
  }

  return `${prefix} ${startLabel}-${endLabel}`;
}
