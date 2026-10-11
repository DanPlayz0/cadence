import { useId, useState, type ComponentProps } from "react";
export function Form({ onSubmit, children, ...props }: ComponentProps<"form">) {
  const [error, setError] = useState("");
  const id = useId();
  return (
    <form
      {...props}
      noValidate
      onInvalid={(event) => event.preventDefault()}
      onSubmit={(event) => {
        const form = event.currentTarget;
        if (!form.checkValidity()) {
          event.preventDefault();
          const invalid = Array.from(form.elements).find(
            (element) =>
              element instanceof HTMLInputElement && !element.validity.valid,
          ) as HTMLInputElement | undefined;
          if (invalid) {
            const trigger =
              invalid.hidden || invalid.getAttribute("aria-hidden") === "true"
                ? invalid.parentElement?.querySelector<HTMLElement>(
                    "[role=combobox], [role=checkbox], [role=radio]",
                  )
                : undefined;
            (trigger || invalid).focus();
            setError(invalid.validationMessage || "Check the required fields.");
          }
          return;
        }
        setError("");
        onSubmit?.(event);
      }}
      aria-describedby={error ? id : props["aria-describedby"]}
    >
      {children}
      {error && (
        <p id={id} role="alert" className="auth-error">
          {error}
        </p>
      )}
    </form>
  );
}
