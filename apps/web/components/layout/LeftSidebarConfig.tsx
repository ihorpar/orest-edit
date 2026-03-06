"use client";

import { Button } from "../ui/Button";

export function LeftSidebarConfig({
  canClear,
  pendingCount,
  reviewCount,
  reviewLoading,
  onClear,
  onRequestReview
}: {
  canClear?: boolean;
  pendingCount: number;
  reviewCount: number;
  reviewLoading?: boolean;
  onClear: () => void;
  onRequestReview: () => void;
}) {
  return (
    <div className="sidebar-stack sidebar-stack-minimal">
      <section className="sidebar-section">
        <p className="mono-ui sidebar-title">На розгляді</p>
        <p className="sidebar-metric">{pendingCount}</p>
      </section>

      <section className="sidebar-section">
        <p className="mono-ui sidebar-title">Редакторський огляд</p>
        <p className="sidebar-body">
          Перевіряє всю рукопис і повертає загальні рекомендації: де текст перевантажений, де слабшає структура і де тон стає занадто
          категоричним.
        </p>
        <Button variant="secondary" size="sm" onClick={onRequestReview} loading={reviewLoading}>
          Перевірити весь текст
        </Button>
        {reviewCount > 0 ? <p className="sidebar-note">{reviewCount} рекомендацій у поточному огляді</p> : null}
      </section>

      <section className="sidebar-section">
        <p className="mono-ui sidebar-title">Фокус</p>
        <p className="sidebar-body">Виділіть фрагмент у редакторі. Далі справа з’явиться одна панель лише для локальної кастомної правки.</p>
      </section>

      <section className="sidebar-section">
        <p className="mono-ui sidebar-title">Чернетка</p>
        <p className="sidebar-body">Скидає рукопис, активне виділення, локальні правки, diff-режим і редакторський огляд до початкового стану.</p>
        <Button variant="secondary" size="sm" onClick={onClear} disabled={!canClear}>
          Очистити
        </Button>
      </section>
    </div>
  );
}
