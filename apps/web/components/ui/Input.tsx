import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error, className, style, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={className ?? "input-minimal"}
      style={{ borderColor: error ? "var(--blood-warning)" : undefined, ...style }}
    />
  );
}