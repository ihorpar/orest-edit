import { useId, type ButtonHTMLAttributes, type CSSProperties } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const variantStyle: Record<ButtonVariant, CSSProperties> = {
  primary: { background: "var(--surgical-blue)", color: "#ffffff", borderColor: "var(--surgical-blue)" },
  secondary: { background: "var(--porcelain)", color: "var(--ink)", borderColor: "#e2e8f0" },
  ghost: { background: "transparent", color: "var(--muted)", borderColor: "transparent" },
  danger: { background: "#ffffff", color: "var(--blood-warning)", borderColor: "#fecaca" }
};

const sizeStyle: Record<ButtonSize, CSSProperties> = {
  sm: { padding: "7px 12px", fontSize: 10 },
  md: { padding: "9px 14px", fontSize: 12 }
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  disabledReason?: string;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  loadingLabel,
  disabledReason,
  disabled,
  style,
  className,
  children,
  ...rest
}: ButtonProps) {
  const disabledReasonId = useId();
  const isDisabled = Boolean(disabled || loading);
  const visibleDisabledReason = isDisabled ? disabledReason?.trim() ?? "" : "";
  const describedBy = [rest["aria-describedby"], visibleDisabledReason ? disabledReasonId : null].filter(Boolean).join(" ") || undefined;
  const wrapperStyle = style?.width ? { width: style.width } : undefined;

  return (
    <span className="button-stack" style={wrapperStyle}>
      <button
        {...rest}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        aria-describedby={describedBy}
        data-loading={loading ? "true" : undefined}
        className={className ? `mono-ui ${className}` : "mono-ui"}
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 0,
          cursor: isDisabled ? "not-allowed" : "pointer",
          opacity: isDisabled ? 0.6 : 1,
          ...sizeStyle[size],
          ...variantStyle[variant],
          ...style
        }}
      >
        {loading ? (
          <span className="button-content">
            <span className="button-spinner" aria-hidden="true" />
            <span>{loadingLabel ?? "Зачекайте…"}</span>
          </span>
        ) : (
          children
        )}
      </button>
      {visibleDisabledReason ? (
        <span id={disabledReasonId} className="button-disabled-reason">
          {visibleDisabledReason}
        </span>
      ) : null}
    </span>
  );
}
