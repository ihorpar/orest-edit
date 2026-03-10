import type { PatchResponse, PatchSelection } from "./patch-contract";
import type { EditorialReviewResponse } from "./review-contract";
import type { RequestHistoryItem } from "../../components/layout/RightOperationsRail";

export type ActivityTone = "info" | "error";
export type AiActivityTaskKind = "patch" | "review";
export type AiActivityTaskStatus = "running" | "completed" | "failed";

export interface AiActivityRequestFeedback {
  message: string;
  tone: ActivityTone;
}

export interface AiPatchTaskSuccessResult {
  kind: "patch";
  status: "completed";
  sourceRevisionId: string;
  selection: PatchSelection;
  payload: PatchResponse;
  feedback: AiActivityRequestFeedback;
  historyEntry: RequestHistoryItem;
}

export interface AiPatchTaskFailureResult {
  kind: "patch";
  status: "failed";
  sourceRevisionId: string;
  selection: PatchSelection;
  message: string;
  diagnostics?: PatchResponse["diagnostics"] | null;
}

export interface AiReviewTaskSuccessResult {
  kind: "review";
  status: "completed";
  sourceRevisionId: string;
  payload: EditorialReviewResponse;
  feedback: AiActivityRequestFeedback;
  historyEntry: RequestHistoryItem;
}

export interface AiReviewTaskFailureResult {
  kind: "review";
  status: "failed";
  sourceRevisionId: string;
  message: string;
  diagnostics?: EditorialReviewResponse["diagnostics"] | null;
}

export type AiActivityTaskResult =
  | AiPatchTaskSuccessResult
  | AiPatchTaskFailureResult
  | AiReviewTaskSuccessResult
  | AiReviewTaskFailureResult;

export interface AiActivityTask {
  id: string;
  kind: AiActivityTaskKind;
  status: AiActivityTaskStatus;
  sourceRevisionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  unread: boolean;
  result: AiActivityTaskResult | null;
}

export function createAiActivityTaskId(prefix = "ai-task"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getAiActivityTaskMessage(task: AiActivityTask): string {
  if (task.status === "running") {
    return "ШІ працює у фоні.";
  }

  if (!task.result) {
    return "Результат недоступний.";
  }

  if (task.result.status === "failed") {
    return task.result.message;
  }

  return task.result.feedback.message;
}

export function getAiActivityTaskTone(task: AiActivityTask): ActivityTone {
  if (!task.result) {
    return "info";
  }

  if (task.result.status === "failed") {
    return "error";
  }

  return task.result.feedback.tone;
}
