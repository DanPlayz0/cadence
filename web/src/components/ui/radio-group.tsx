import * as Primitive from "@radix-ui/react-radio-group";
import { type ComponentProps } from "react";
import { cn } from "./utils";
import { useControl } from "./useControl";
export function RadioGroup({
  disabled,
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  const control = useControl<HTMLDivElement>(disabled);
  return (
    <Primitive.Root {...props} ref={control.ref} disabled={control.disabled} />
  );
}
export function Radio({
  className,
  disabled,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  const control = useControl<HTMLButtonElement>(disabled);
  return (
    <Primitive.Item
      {...props}
      ref={control.ref}
      disabled={control.disabled}
      className={cn("ui-radio", className)}
    >
      <Primitive.Indicator className="ui-radio-indicator" />
    </Primitive.Item>
  );
}
