import * as Primitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "./utils";
export const AlertDialog = Primitive.Root;
export const AlertDialogTrigger = Primitive.Trigger;
export const AlertDialogTitle = Primitive.Title;
export const AlertDialogDescription = Primitive.Description;
export const AlertDialogCancel = Primitive.Cancel;
export function AlertDialogContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="ui-dialog-overlay" />
      <Primitive.Content
        {...props}
        className={cn("account-dialog ui-dialog-content", className)}
      />
    </Primitive.Portal>
  );
}
