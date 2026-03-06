import type { InputHTMLAttributes } from "react";

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export function Toggle({ label, defaultChecked, checked, ...rest }: ToggleProps) {
  const isOn = checked ?? defaultChecked;

  return (
    <div className="switch-row">
      <span>{label}</span>
      <span className="switch-track" aria-hidden="true" data-on={isOn ? "true" : "false"}>
        <span className="switch-thumb" />
      </span>
      <input {...rest} type="checkbox" checked={checked} defaultChecked={defaultChecked} hidden readOnly={checked !== undefined && !rest.onChange} />
    </div>
  );
}
