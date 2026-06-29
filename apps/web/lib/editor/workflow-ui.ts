import type { AppLocale } from "../i18n/product-locale";

export type RequestFeedbackTone = "info" | "error";

export interface RequestFeedback {
  message: string;
  tone: RequestFeedbackTone;
}

export type WorkflowStepUiId =
  | "diagnostics"
  | "fact_check"
  | "structure"
  | "clarity"
  | "interest"
  | "visuals"
  | "formatting"
  | "emphasis"
  | "spellcheck"
  | "final_editing";

export type WorkflowStatusTone = "idle" | "active" | "success" | "warning" | "error";

export interface WorkflowStatusPresentation {
  tone: WorkflowStatusTone;
  label: string;
  message: string;
}

export interface WorkflowFeedbackPresentation {
  tone: "success" | "error";
  label: string;
  message: string;
}

export interface StepPrimaryActionPresentation {
  label: string;
  loadingLabel: string;
  ariaLabel: string;
  emphasis: "primary" | "secondary";
}

export function presentRequestFeedback(feedback: RequestFeedback | null, locale: AppLocale = "uk"): WorkflowFeedbackPresentation | null {
  if (!feedback?.message.trim()) {
    return null;
  }

  if (feedback.tone === "error") {
    return {
      tone: "error",
      label: locale === "en" ? "Error" : "Помилка",
      message: feedback.message
    };
  }

  return {
    tone: "success",
    label: locale === "en" ? "Done" : "Готово",
    message: feedback.message
  };
}

export function getStepPrimaryAction(
  stepId: WorkflowStepUiId,
  options: { hasExistingResult: boolean },
  locale: AppLocale = "uk"
): StepPrimaryActionPresentation {
  const rerun = options.hasExistingResult;
  const labels = locale === "en"
    ? {
        diagnostics: ["Run diagnostics", "Refresh diagnostics", "Running diagnostics…", "Refreshing diagnostics…"],
        factCheck: ["Run fact-check", "Refresh fact-check", "Running fact-check…", "Refreshing fact-check…"],
        spellcheck: ["Run spelling review", "Refresh spelling review", "Checking spelling…", "Refreshing spelling review…"],
        recs: ["Generate recommendations", "Refresh recommendations", "Preparing recommendations…", "Refreshing recommendations…"]
      }
    : {
        diagnostics: ["Запустити діагностику", "Оновити діагностику", "Запускаємо діагностику…", "Оновлюємо діагностику…"],
        factCheck: ["Запустити факт-чек", "Оновити факт-чек", "Запускаємо факт-чек…", "Оновлюємо факт-чек…"],
        spellcheck: ["Проаналізувати правопис", "Оновити аналіз правопису", "Аналізуємо правопис…", "Оновлюємо аналіз правопису…"],
        recs: ["Згенерувати рекомендації", "Оновити рекомендації", "Готуємо рекомендації…", "Оновлюємо рекомендації…"]
      };

  switch (stepId) {
    case "diagnostics":
      return {
        label: rerun ? labels.diagnostics[1] : labels.diagnostics[0],
        loadingLabel: rerun ? labels.diagnostics[3] : labels.diagnostics[2],
        ariaLabel: rerun ? labels.diagnostics[1] : labels.diagnostics[0],
        emphasis: rerun ? "secondary" : "primary"
      };
    case "fact_check":
      return {
        label: rerun ? labels.factCheck[1] : labels.factCheck[0],
        loadingLabel: rerun ? labels.factCheck[3] : labels.factCheck[2],
        ariaLabel: rerun ? labels.factCheck[1] : labels.factCheck[0],
        emphasis: rerun ? "secondary" : "primary"
      };
    case "spellcheck":
      return {
        label: rerun ? labels.spellcheck[1] : labels.spellcheck[0],
        loadingLabel: rerun ? labels.spellcheck[3] : labels.spellcheck[2],
        ariaLabel: rerun ? labels.spellcheck[1] : labels.spellcheck[0],
        emphasis: rerun ? "secondary" : "primary"
      };
    default:
      return {
        label: rerun ? labels.recs[1] : labels.recs[0],
        loadingLabel: rerun ? labels.recs[3] : labels.recs[2],
        ariaLabel: rerun ? labels.recs[1] : labels.recs[0],
        emphasis: rerun ? "secondary" : "primary"
      };
  }
}

export function getStepWorkspaceStatus(
  stepId: WorkflowStepUiId,
  options: {
    canRun: boolean;
    isInFlight: boolean;
    hasExistingResult: boolean;
    hasPrerequisite?: boolean;
    zeroResult?: boolean;
    successMessage?: string;
    idleMessage: string;
    waitingMessage?: string;
    activeMessage: string;
    zeroResultMessage?: string;
  },
  locale: AppLocale = "uk"
): WorkflowStatusPresentation {
  const labels = locale === "en"
    ? {
        active: "In progress",
        empty: "No results",
        done: "Done",
        waiting: "Waiting",
        unavailable: "Unavailable",
        idle: "Not run yet"
      }
    : {
        active: "У процесі",
        empty: "Без результатів",
        done: "Готово",
        waiting: "Очікує",
        unavailable: "Недоступно",
        idle: "Не запускалось"
      };

  if (options.isInFlight) {
    return {
      tone: "active",
      label: labels.active,
      message: options.activeMessage
    };
  }

  if (options.zeroResult && options.zeroResultMessage) {
    return {
      tone: "idle",
      label: labels.empty,
      message: options.zeroResultMessage
    };
  }

  if (options.hasExistingResult) {
    return {
      tone: stepId === "spellcheck" && options.zeroResult ? "idle" : "success",
      label: labels.done,
      message: options.successMessage ?? options.idleMessage
    };
  }

  if (!options.hasPrerequisite && options.waitingMessage) {
    return {
      tone: "warning",
      label: labels.waiting,
      message: options.waitingMessage
    };
  }

  if (!options.canRun && !options.hasExistingResult) {
    return {
      tone: "warning",
      label: labels.unavailable,
      message: options.waitingMessage ?? options.idleMessage
    };
  }

  return {
    tone: "idle",
    label: labels.idle,
    message: options.idleMessage
  };
}
