// SPDX-License-Identifier: GPL-2.0-or-later
import { useId, type InputHTMLAttributes, type ChangeEvent } from "react";
import * as Primitive from "@radix-ui/react-checkbox";
import { useControl } from "./useControl";
import { Check } from "lucide-react";

export function Checkbox({
  label,
  description,
  checked,
  defaultChecked,
  onChange,
  disabled,
  name,
  value,
  id: suppliedId,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
  description?: string;
}) {
  const generatedId = useId(),
    id = suppliedId || generatedId;
  const control = useControl<HTMLButtonElement>(disabled);
  const item = (
    <Primitive.Root
      ref={control.ref}
      id={id}
      name={name}
      value={String(value ?? "on")}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={control.disabled}
      required={props.required}
      aria-label={props["aria-label"]}
      aria-labelledby={label ? `${id}-label` : props["aria-labelledby"]}
      aria-describedby={
        description ? `${id}-description` : props["aria-describedby"]
      }
      className={`ui-checkbox ${className || ""}`}
      onCheckedChange={(next) =>
        onChange?.({
          target: { checked: next === true },
          currentTarget: { checked: next === true },
        } as ChangeEvent<HTMLInputElement>)
      }
    >
      <Primitive.Indicator>
        <Check size={16} strokeWidth={3} />
      </Primitive.Indicator>
    </Primitive.Root>
  );
  if (!label) return item;
  return (
    <label className="themed-checkbox" htmlFor={id}>
      {item}
      <span className="checkbox-copy">
        <span id={`${id}-label`}>{label}</span>
        {description && <small id={`${id}-description`}>{description}</small>}
      </span>
    </label>
  );
}
