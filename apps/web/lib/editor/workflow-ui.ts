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

export function presentRequestFeedback(feedback: RequestFeedback | null): WorkflowFeedbackPresentation | null {
  if (!feedback?.message.trim()) {
    return null;
  }

  if (feedback.tone === "error") {
    return {
      tone: "error",
      label: "Помилка",
      message: feedback.message
    };
  }

  return {
    tone: "success",
    label: "Готово",
    message: feedback.message
  };
}

export function getStepPrimaryAction(stepId: WorkflowStepUiId, options: { hasExistingResult: boolean }): StepPrimaryActionPresentation {
  const rerun = options.hasExistingResult;

  switch (stepId) {
    case "diagnostics":
      return {
        label: rerun ? "Оновити діагностику" : "Запустити діагностику",
        loadingLabel: rerun ? "Оновлюємо діагностику…" : "Запускаємо діагностику…",
        ariaLabel: rerun ? "Оновити діагностику" : "Запустити діагностику",
        emphasis: rerun ? "secondary" : "primary"
      };
    case "fact_check":
      return {
        label: rerun ? "Оновити факт-чек" : "Запустити факт-чек",
        loadingLabel: rerun ? "Оновлюємо факт-чек…" : "Запускаємо факт-чек…",
        ariaLabel: rerun ? "Оновити факт-чек" : "Запустити факт-чек",
        emphasis: rerun ? "secondary" : "primary"
      };
    case "spellcheck":
      return {
        label: rerun ? "Оновити аналіз правопису" : "Проаналізувати правопис",
        loadingLabel: rerun ? "Оновлюємо аналіз правопису…" : "Аналізуємо правопис…",
        ariaLabel: rerun ? "Оновити аналіз правопису" : "Проаналізувати правопис",
        emphasis: rerun ? "secondary" : "primary"
      };
    default:
      return {
        label: rerun ? "Оновити рекомендації" : "Згенерувати рекомендації",
        loadingLabel: rerun ? "Оновлюємо рекомендації…" : "Готуємо рекомендації…",
        ariaLabel: rerun ? "Оновити рекомендації" : "Згенерувати рекомендації",
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
  }
): WorkflowStatusPresentation {
  if (options.isInFlight) {
    return {
      tone: "active",
      label: "У процесі",
      message: options.activeMessage
    };
  }

  if (options.zeroResult && options.zeroResultMessage) {
    return {
      tone: "idle",
      label: "Без результатів",
      message: options.zeroResultMessage
    };
  }

  if (options.hasExistingResult) {
    return {
      tone: stepId === "spellcheck" && options.zeroResult ? "idle" : "success",
      label: "Готово",
      message: options.successMessage ?? options.idleMessage
    };
  }

  if (!options.hasPrerequisite && options.waitingMessage) {
    return {
      tone: "warning",
      label: "Очікує",
      message: options.waitingMessage
    };
  }

  if (!options.canRun && !options.hasExistingResult) {
    return {
      tone: "warning",
      label: "Недоступно",
      message: options.waitingMessage ?? options.idleMessage
    };
  }

  return {
    tone: "idle",
    label: "Не запускалось",
    message: options.idleMessage
  };
}
