import { useId, useLayoutEffect, useRef, type ComponentProps } from "react";
import { Input } from "./input";
export function validDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function DateField({
  onChange,
  ref: forwardedRef,
  ...props
}: Omit<ComponentProps<typeof Input>, "type">) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const validate = () =>
      field.setCustomValidity(
        validDate(field.value) ? "" : "Enter a valid date as YYYY-MM-DD.",
      );
    validate();
    const reset = () => queueMicrotask(validate);
    field.form?.addEventListener("reset", reset);
    return () => field.form?.removeEventListener("reset", reset);
  }, [props.value, props.defaultValue]);
  const invalid = !validDate(String(props.value || ""));
  return (
    <>
      <Input
        {...props}
        ref={(element) => {
          input.current = element;
          if (typeof forwardedRef === "function") forwardedRef(element);
          else if (forwardedRef) forwardedRef.current = element;
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? id : props["aria-describedby"]}
        type="text"
        placeholder="YYYY-MM-DD"
        pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
        onChange={(event) => {
          event.currentTarget.setCustomValidity(
            validDate(event.currentTarget.value)
              ? ""
              : "Enter a valid date as YYYY-MM-DD.",
          );
          onChange?.(event);
        }}
      />
      {invalid && (
        <span id={id} role="alert" className="ui-field-error">
          Enter a valid date as YYYY-MM-DD.
        </span>
      )}
    </>
  );
}
