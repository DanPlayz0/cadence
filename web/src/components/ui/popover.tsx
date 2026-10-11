import * as Primitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "./utils";
export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export function PopoverContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        {...props}
        sideOffset={6}
        collisionPadding={8}
        className={cn("ui-popover-content", className)}
      />
    </Primitive.Portal>
  );
}
