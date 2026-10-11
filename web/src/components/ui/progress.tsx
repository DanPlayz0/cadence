import * as Primitive from "@radix-ui/react-progress";
import type { ComponentProps } from "react";
export function Progress({
  value,
  max = 100,
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root {...props} value={value} max={max} className="ui-progress">
      <Primitive.Indicator
        className="ui-progress-indicator"
        style={{
          width: `${value == null ? 25 : Math.min(100, Math.max(0, (value / max) * 100))}%`,
        }}
      />
    </Primitive.Root>
  );
}
