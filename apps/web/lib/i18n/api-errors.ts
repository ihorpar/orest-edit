import { getDefaultAppLocale, isAppLocale, type AppLocale } from "./product-locale";

export { getDefaultAppLocale };

const API_ERRORS = {
  uk: {
    invalidRequestBody: "Некоректне тіло запиту.",
    requestMustBeJsonObject: "Запит має бути JSON-об'єктом.",
    documentRequired: "Поле document є обов'язковим.",
    targetBlockIdsRequired: "Потрібно передати targetBlockIds.",
    currentRevisionRequired: "Потрібно передати currentRevision.",
    reviewItemRequired: "Потрібно передати review item.",
    manuscriptRevisionRequired: "Потрібно передати поточний revision рукопису.",
    jobIdRequired: "Потрібно передати jobId.",
    reviewJobNotFound: "Чергу review не знайдено або вона вже протермінована. Запустіть крок ще раз.",
    imageJobNotFound: "Чергу генерації не знайдено або вона вже протермінована.",
    promptRequired: "Поле prompt є обов'язковим.",
    promptMustBeString: "Поле prompt має бути рядком.",
    documentRevisionIdRequired: "Потрібно передати documentRevisionId.",
    unsupportedSpellcheckProvider: "Непідтримуваний spellcheck provider.",
    manualSpellcheckOnly: "У v1 підтримується лише manual spellcheck.",
    selectionRequired: "Потрібно передати selection.",
    selectionBlockIdRequired: "Потрібно передати selection.blockId.",
    selectionTextRequired: "Потрібно передати selection.text.",
    selectionRangeRequired: "Потрібно передати selection.range.",
    invalidSelectionRange: "Некоректний selection.range для переданого тексту.",
    emptySelectionFragment: "Виділений фрагмент порожній. Оберіть текст без порожнього пробілу.",
    invalidModelIdFormat: "Model id має невалідний формат.",
    serverPasswordNotConfigured: "Серверний пароль не налаштовано. Додайте APP_PASSWORD у змінні середовища.",
    invalidPassword: "Невірний пароль.",
    authRequired: "Потрібна авторизація."
  },
  en: {
    invalidRequestBody: "Invalid request body.",
    requestMustBeJsonObject: "Request must be a JSON object.",
    documentRequired: "The document field is required.",
    targetBlockIdsRequired: "targetBlockIds is required.",
    currentRevisionRequired: "currentRevision is required.",
    reviewItemRequired: "A review item is required.",
    manuscriptRevisionRequired: "The current manuscript revision is required.",
    jobIdRequired: "jobId is required.",
    reviewJobNotFound: "Review queue not found or expired. Run the step again.",
    imageJobNotFound: "Generation queue not found or expired.",
    promptRequired: "The prompt field is required.",
    promptMustBeString: "The prompt field must be a string.",
    documentRevisionIdRequired: "documentRevisionId is required.",
    unsupportedSpellcheckProvider: "Unsupported spellcheck provider.",
    manualSpellcheckOnly: "Only manual spellcheck is supported in v1.",
    selectionRequired: "selection is required.",
    selectionBlockIdRequired: "selection.blockId is required.",
    selectionTextRequired: "selection.text is required.",
    selectionRangeRequired: "selection.range is required.",
    invalidSelectionRange: "Invalid selection.range for the provided text.",
    emptySelectionFragment: "The selected fragment is empty. Select text without a blank space.",
    invalidModelIdFormat: "Model id has an invalid format.",
    serverPasswordNotConfigured: "Server password is not configured. Add APP_PASSWORD to environment variables.",
    invalidPassword: "Incorrect password.",
    authRequired: "Authentication required."
  }
} as const;

export type ApiErrors = (typeof API_ERRORS)[AppLocale];

export function getApiErrors(locale: AppLocale): ApiErrors {
  return API_ERRORS[locale];
}

export function resolveRequestLocale(body: unknown): AppLocale {
  if (body && typeof body === "object") {
    const locale = (body as Record<string, unknown>).locale;

    if (isAppLocale(locale)) {
      return locale;
    }
  }

  return getDefaultAppLocale();
}

export function resolveQueryLocale(searchParams: URLSearchParams): AppLocale {
  const locale = searchParams.get("locale");

  if (isAppLocale(locale)) {
    return locale;
  }

  return getDefaultAppLocale();
}
