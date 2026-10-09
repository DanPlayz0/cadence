// Adapted from shadcn/ui (MIT); see THIRD_PARTY_NOTICES.md.
import type { ComponentProps } from "react";
import { cn } from "./utils";
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input data-slot="input" className={cn("ui-input", className)} {...props} />
  );
}
