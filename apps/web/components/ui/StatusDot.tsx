type ModelValidationState = "idle" | "checking" | "valid" | "missing" | "invalid" | "missing_key" | "auth_error" | "model_error" | "network_error";

const palette: Record<ModelValidationState, string> = {
  idle: "#94a3b8",
  checking: "#2563eb",
  valid: "#12a66a",
  missing: "#c06f08",
  invalid: "#b45309",
  missing_key: "#c06f08",
  auth_error: "#b42318",
  model_error: "#b45309",
  network_error: "#7a7f87"
};

export function StatusDot({ state }: { state: ModelValidationState }) {
  return (
    <span
      aria-label={`model-status-${state}`}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 999,
        background: palette[state]
      }}
    />
  );
}
