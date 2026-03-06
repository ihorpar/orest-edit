import type { PatchOperation, PatchOperationType } from "./patch-contract";

export type ModelValidationState = "valid" | "missing" | "invalid" | "auth_error" | "network_error";
export type OperationType = PatchOperationType;
export type EvidenceState = "verified" | "required" | "insufficient_evidence";

export interface SourceVM {
  title?: string;
  url: string;
  domain: string;
}

export interface OperationVM extends PatchOperation {
  evidenceState?: EvidenceState;
  sources?: SourceVM[];
}

export const demoOperations: OperationVM[] = [];
