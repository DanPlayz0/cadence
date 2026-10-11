import * as React from "react";
import * as Primitive from "@radix-ui/react-slider";
import { useControl } from "./useControl";
import { cn } from "./utils";
type Props = Omit<
  React.ComponentProps<"input">,
  "type" | "ref" | "defaultValue"
>;
export function Slider({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled,
  className,
  name,
  ...props
}: Props) {
  const control = useControl<HTMLSpanElement>(disabled);
  const lower = Number(min),
    upper = Math.max(lower + Number(step), Number(max));
  return (
    <Primitive.Root
      ref={control.ref}
      name={name}
      className={cn("ui-slider", className)}
      min={lower}
      max={upper}
      step={Number(step)}
      value={[Math.min(upper, Math.max(lower, Number(value)))]}
      disabled={control.disabled}
      onValueChange={([value]) =>
        onChange?.({
          target: { value: String(value) },
          currentTarget: { value: String(value) },
        } as React.ChangeEvent<HTMLInputElement>)
      }
    >
      <Primitive.Track className="ui-slider-track">
        <Primitive.Range className="ui-slider-range" />
      </Primitive.Track>
      <Primitive.Thumb
        className="ui-slider-thumb"
        aria-label={props["aria-label"]}
        aria-valuetext={props["aria-valuetext"]}
        aria-labelledby={props["aria-labelledby"]}
      />
    </Primitive.Root>
  );
}
