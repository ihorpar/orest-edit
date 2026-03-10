import type { TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ error, className, style, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      className={`textarea-minimal ${className ?? ""}`}
      style={{
        borderColor: error ? "var(--blood-warning)" : undefined,
        ...style
      }}
    />
  );
}
