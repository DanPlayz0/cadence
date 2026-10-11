// Adapted from shadcn/ui (MIT); see THIRD_PARTY_NOTICES.md.
import { useId, useState, type ComponentProps } from "react";
import { cn } from "./utils";
export function Input({
  className,
  onInvalid,
  onChange,
  ...props
}: ComponentProps<"input">) {
  const [error, setError] = useState("");
  const id = useId();
  return (
    <>
      <input
        data-slot="input"
        className={cn("ui-input", className)}
        {...props}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={
          [props["aria-describedby"], error ? id : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onInvalid={(event) => {
          event.preventDefault();
          setError(event.currentTarget.validationMessage);
          onInvalid?.(event);
        }}
        onChange={(event) => {
          onChange?.(event);
          if (error)
            setError(
              event.currentTarget.validity.valid
                ? ""
                : event.currentTarget.validationMessage,
            );
        }}
      />
      {error && (
        <span id={id} className="ui-field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
