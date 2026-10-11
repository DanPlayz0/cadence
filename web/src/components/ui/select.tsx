import * as React from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./utils";
import { useControl } from "./useControl";

const empty = "__cadence_empty_selection__";
type OptionProps = {
  value: string;
  children?: React.ReactNode;
  disabled?: boolean;
  textValue?: string;
};
export function SelectItem(_props: OptionProps) {
  return null;
}
function options(children: React.ReactNode): OptionProps[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement<OptionProps>(child)) return [];
    return child.type === React.Fragment
      ? options(child.props.children)
      : [child.props];
  });
}
type Props = Omit<
  React.ComponentProps<"button">,
  "children" | "onChange" | "value" | "defaultValue" | "ref"
> & {
  children: React.ReactNode;
  displayValue?: React.ReactNode;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
};
export function Select({
  children,
  displayValue,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  required,
  className,
  id,
  ...props
}: Props) {
  const items = options(children);
  const [local, setLocal] = React.useState(
    String(defaultValue ?? items[0]?.value ?? ""),
  );
  const selected = String(value ?? local);
  const [error, setError] = React.useState("");
  const errorId = React.useId();
  const control = useControl<HTMLButtonElement>(disabled);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (control.disabled) setOpen(false);
  }, [control.disabled]);
  React.useEffect(() => {
    const form = control.ref.current?.closest("form");
    const reset = () => {
      setLocal(String(defaultValue ?? items[0]?.value ?? ""));
      setError("");
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue, children]);
  return (
    <Primitive.Root
      open={open}
      onOpenChange={setOpen}
      value={selected || empty}
      disabled={control.disabled}
      onValueChange={(next) => {
        if (control.disabled) return;
        const value = next === empty ? "" : next;
        setError("");
        setLocal(value);
        onChange?.({
          target: { value },
          currentTarget: { value },
        } as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <Primitive.Trigger
        {...props}
        ref={control.ref}
        id={id}
        className={cn("ui-select", className)}
        aria-required={required}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={
          [props["aria-describedby"], error ? errorId : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
      >
        <Primitive.Value>{displayValue}</Primitive.Value>
        <Primitive.Icon>
          <ChevronDown size={16} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          position="popper"
          sideOffset={5}
          collisionPadding={8}
          className="ui-select-content"
        >
          <Primitive.ScrollUpButton className="ui-select-scroll">
            ▲
          </Primitive.ScrollUpButton>
          <Primitive.Viewport>
            {items.map((item) => (
              <Primitive.Item
                key={item.value}
                value={item.value || empty}
                disabled={item.disabled}
                textValue={item.textValue}
                className="ui-select-item"
              >
                <Primitive.ItemText>{item.children}</Primitive.ItemText>
                <Primitive.ItemIndicator>
                  <Check size={16} />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="ui-select-scroll">
            ▼
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
      {name && (
        <input
          name={name}
          value={selected}
          required={required}
          disabled={control.disabled}
          hidden
          readOnly={false}
          onChange={() => {}}
          onInvalid={(event) => {
            event.preventDefault();
            setError(event.currentTarget.validationMessage);
          }}
          data-select-value=""
        />
      )}
      {error && (
        <span id={errorId} className="ui-field-error" role="alert">
          {error}
        </span>
      )}
    </Primitive.Root>
  );
}
