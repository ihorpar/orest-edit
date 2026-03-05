import type { ButtonHTMLAttributes, CSSProperties } from "react";

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
}

export function Button({ variant = "secondary", size = "md", loading, disabled, style, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className="mono-ui"
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 0,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled || loading ? 0.6 : 1,
        ...sizeStyle[size],
        ...variantStyle[variant],
        ...style
      }}
    >
      {loading ? "Зачекайте" : children}
    </button>
  );
}
