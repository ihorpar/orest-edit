import type { SelectHTMLAttributes } from "react";

export function Select({ className, style, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select-root">
      <select
        {...rest}
        className={`select-minimal ${className ?? ""}`}
        style={style}
      >
        {children}
      </select>
      <div className="select-arrow" aria-hidden="true">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
