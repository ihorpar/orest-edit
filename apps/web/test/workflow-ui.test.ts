import test from "node:test";
import assert from "node:assert/strict";

import {
  getStepPrimaryAction,
  getStepWorkspaceStatus,
  presentRequestFeedback
} from "../lib/editor/workflow-ui.ts";

test("presentRequestFeedback maps info feedback to a visible success presentation", () => {
  assert.deepEqual(presentRequestFeedback({ tone: "info", message: "Правку застосовано." }), {
    tone: "success",
    label: "Готово",
    message: "Правку застосовано."
  });
});

test("presentRequestFeedback preserves error feedback as error presentation", () => {
  assert.deepEqual(presentRequestFeedback({ tone: "error", message: "Не вдалося виконати дію." }), {
    tone: "error",
    label: "Помилка",
    message: "Не вдалося виконати дію."
  });
});

test("getStepPrimaryAction returns explicit first-run CTA labels", () => {
  assert.equal(getStepPrimaryAction("diagnostics", { hasExistingResult: false }).label, "Запустити діагностику");
  assert.equal(getStepPrimaryAction("fact_check", { hasExistingResult: false }).label, "Запустити факт-чек");
  assert.equal(getStepPrimaryAction("spellcheck", { hasExistingResult: false }).label, "Проаналізувати правопис");
  assert.equal(getStepPrimaryAction("clarity", { hasExistingResult: false }).label, "Згенерувати рекомендації");
});

test("getStepPrimaryAction returns rerun CTA labels for existing results", () => {
  assert.equal(getStepPrimaryAction("diagnostics", { hasExistingResult: true }).label, "Оновити діагностику");
  assert.equal(getStepPrimaryAction("fact_check", { hasExistingResult: true }).label, "Оновити факт-чек");
  assert.equal(getStepPrimaryAction("spellcheck", { hasExistingResult: true }).label, "Оновити аналіз правопису");
  assert.equal(getStepPrimaryAction("visuals", { hasExistingResult: true }).label, "Оновити рекомендації");
});

test("getStepWorkspaceStatus distinguishes waiting, active, success, and zero-result states", () => {
  assert.deepEqual(
    getStepWorkspaceStatus("fact_check", {
      canRun: false,
      hasPrerequisite: false,
      isInFlight: false,
      hasExistingResult: false,
      waitingMessage: "Спочатку запустіть діагностику.",
      idleMessage: "Запустіть факт-чек.",
      activeMessage: "Перевіряємо твердження."
    }),
    {
      tone: "warning",
      label: "Очікує",
      message: "Спочатку запустіть діагностику."
    }
  );

  assert.deepEqual(
    getStepWorkspaceStatus("diagnostics", {
      canRun: true,
      isInFlight: true,
      hasExistingResult: false,
      idleMessage: "Запустіть діагностику.",
      activeMessage: "Аналізуємо рукопис."
    }),
    {
      tone: "active",
      label: "У процесі",
      message: "Аналізуємо рукопис."
    }
  );

  assert.deepEqual(
    getStepWorkspaceStatus("clarity", {
      canRun: true,
      isInFlight: false,
      hasExistingResult: true,
      idleMessage: "Запустіть етап.",
      activeMessage: "Готуємо рекомендації.",
      successMessage: "Рекомендації готові."
    }),
    {
      tone: "success",
      label: "Готово",
      message: "Рекомендації готові."
    }
  );

  assert.deepEqual(
    getStepWorkspaceStatus("spellcheck", {
      canRun: true,
      isInFlight: false,
      hasExistingResult: true,
      zeroResult: true,
      idleMessage: "Запустіть аналіз.",
      activeMessage: "Аналізуємо правопис.",
      zeroResultMessage: "Помилки не знайдено."
    }),
    {
      tone: "idle",
      label: "Без результатів",
      message: "Помилки не знайдено."
    }
  );
});

test("getStepWorkspaceStatus prioritizes active and completed states over can-run gating", () => {
  assert.deepEqual(
    getStepWorkspaceStatus("diagnostics", {
      canRun: false,
      isInFlight: true,
      hasExistingResult: false,
      idleMessage: "Запустіть діагностику.",
      waitingMessage: "Додайте текст рукопису, щоб запустити діагностику.",
      activeMessage: "Аналізуємо рукопис."
    }),
    {
      tone: "active",
      label: "У процесі",
      message: "Аналізуємо рукопис."
    }
  );

  assert.deepEqual(
    getStepWorkspaceStatus("diagnostics", {
      canRun: false,
      isInFlight: false,
      hasExistingResult: true,
      idleMessage: "Запустіть діагностику.",
      waitingMessage: "Додайте текст рукопису, щоб запустити діагностику.",
      activeMessage: "Аналізуємо рукопис.",
      successMessage: "Діагностику завершено."
    }),
    {
      tone: "success",
      label: "Готово",
      message: "Діагностику завершено."
    }
  );
});
