type ModelValidationState = "valid" | "missing" | "invalid" | "auth_error" | "network_error";

const palette: Record<ModelValidationState, string> = {
  valid: "#12a66a",
  missing: "#c06f08",
  invalid: "#b45309",
  auth_error: "#b42318",
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
