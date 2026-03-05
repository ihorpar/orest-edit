import type { TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ error, className, style, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      className={className}
      style={{
        width: "100%",
        border: `1px solid ${error ? "var(--blood-warning)" : "#dbe4ef"}`,
        borderRadius: 0,
        padding: "10px 12px",
        fontSize: 14,
        lineHeight: 1.5,
        ...style
      }}
    />
  );
}
