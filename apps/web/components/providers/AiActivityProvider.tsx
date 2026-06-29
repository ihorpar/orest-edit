"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  createAiActivityTaskId,
  type AiActivityTask,
  type AiActivityTaskStatus,
  type AiActivityTaskKind,
  type AiActivityTaskResult
} from "../../lib/editor/ai-activity";
import { useProductLocale } from "./ProductLocaleProvider";

interface TrackAiTaskInput {
  kind: AiActivityTaskKind;
  sourceRevisionId: string;
  title: string;
}

interface AiActivityContextValue {
  tasks: AiActivityTask[];
  runningCount: number;
  unreadCount: number;
  trackTask: (input: TrackAiTaskInput, task: Promise<AiActivityTaskResult>) => string;
  markTaskSeen: (taskId: string) => void;
  dismissTask: (taskId: string) => void;
}

const AiActivityContext = createContext<AiActivityContextValue | null>(null);

export function AiActivityProvider({ children }: { children: ReactNode }) {
  const { locale } = useProductLocale();
  const [tasks, setTasks] = useState<AiActivityTask[]>([]);

  function trackTask(input: TrackAiTaskInput, task: Promise<AiActivityTaskResult>) {
    const taskId = createAiActivityTaskId(input.kind);
    const startedAt = Date.now();
    const runningTask: AiActivityTask = {
      id: taskId,
      kind: input.kind,
      status: "running",
      sourceRevisionId: input.sourceRevisionId,
      title: input.title,
      createdAt: startedAt,
      updatedAt: startedAt,
      unread: false,
      result: null
    };

    setTasks((current) => [runningTask, ...current].slice(0, 12));

    void task
      .then((result) => {
        const updatedAt = Date.now();
        const nextStatus: AiActivityTaskStatus = result.status;

        setTasks((current) =>
          current.map((entry) =>
            entry.id === taskId
              ? {
                  ...entry,
                  status: nextStatus,
                  sourceRevisionId: result.sourceRevisionId,
                  updatedAt,
                  unread: true,
                  result
                }
              : entry
          )
        );
      })
      .catch((error) => {
        const updatedAt = Date.now();
        const message = error instanceof Error ? error.message : locale === "en"
          ? "A background AI request failed."
          : "Сталася помилка під час фонового AI-запиту.";

        setTasks((current) =>
          current.map((entry) =>
            entry.id === taskId
              ? {
                  ...entry,
                  status: "failed",
                  updatedAt,
                  unread: true,
                  result: {
                    kind: entry.kind,
                    status: "failed",
                    sourceRevisionId: entry.sourceRevisionId,
                    ...(entry.kind === "patch"
                      ? {
                          selection: { start: 0, end: 0 }
                        }
                      : {}),
                    message
                  } as AiActivityTaskResult
                }
              : entry
          )
        );
      });

    return taskId;
  }

  function markTaskSeen(taskId: string) {
    setTasks((current) => current.map((entry) => (entry.id === taskId ? { ...entry, unread: false } : entry)));
  }

  function dismissTask(taskId: string) {
    setTasks((current) => current.filter((entry) => entry.id !== taskId));
  }

  const value = useMemo<AiActivityContextValue>(
    () => ({
      tasks,
      runningCount: tasks.filter((entry) => entry.status === "running").length,
      unreadCount: tasks.filter((entry) => entry.unread && entry.status !== "running").length,
      trackTask,
      markTaskSeen,
      dismissTask
    }),
    [tasks]
  );

  return <AiActivityContext.Provider value={value}>{children}</AiActivityContext.Provider>;
}

export function useAiActivity() {
  const context = useContext(AiActivityContext);

  if (!context) {
    throw new Error("useAiActivity must be used inside AiActivityProvider.");
  }

  return context;
}
