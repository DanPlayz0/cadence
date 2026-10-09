// Adapted from shadcn/ui (MIT); see THIRD_PARTY_NOTICES.md.
import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { cn } from "./utils";
export const Dialog = Primitive.Root;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export const DialogClose = Primitive.Close;
export function DialogContent({
  className,
  children,
  busy = false,
  onEscapeKeyDown,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof Primitive.Content> & { busy?: boolean }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="ui-dialog-overlay" />
      <Primitive.Content
        data-slot="dialog-content"
        className={cn("account-dialog ui-dialog-content", className)}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
          onEscapeKeyDown?.(event);
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
          onInteractOutside?.(event);
        }}
        {...props}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
