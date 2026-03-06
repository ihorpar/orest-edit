import type { SelectHTMLAttributes } from "react";

export function Select({ className, style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={className ?? "select-minimal"} style={style} />;
}
