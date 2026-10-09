// SPDX-License-Identifier: GPL-2.0-or-later
import { useId, type InputHTMLAttributes } from "react";
import { Check } from "lucide-react";

export function Checkbox({
  label,
  description,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <label className="themed-checkbox">
      <input
        {...props}
        type="checkbox"
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
      />
      <span className="checkbox-box" aria-hidden="true">
        <Check size={16} strokeWidth={3} />
      </span>
      <span className="checkbox-copy">
        <span id={`${id}-label`}>{label}</span>
        {description && <small id={`${id}-description`}>{description}</small>}
      </span>
    </label>
  );
}
