// Adapted from shadcn/ui (MIT); see THIRD_PARTY_NOTICES.md.
import * as React from "react";
import * as Primitive from "@radix-ui/react-dropdown-menu";
import { cn } from "./utils";
export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuLabel = Primitive.Label;
export const DropdownMenuSub = Primitive.Sub;
export function DropdownMenuSubTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.SubTrigger>) {
  return (
    <Primitive.SubTrigger
      className={cn("ui-dropdown-item", className)}
      {...props}
    />
  );
}
export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        data-slot="dropdown-menu-content"
        collisionPadding={8}
        sideOffset={6}
        className={cn("ui-dropdown-content", className)}
        {...props}
      />
    </Primitive.Portal>
  );
}
export function DropdownMenuCheckboxItem({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.CheckboxItem>) {
  return (
    <Primitive.CheckboxItem
      className={cn("ui-dropdown-item", className)}
      {...props}
    />
  );
}
export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn("ui-dropdown-content", className)}
        {...props}
      />
    </Primitive.Portal>
  );
}
export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item className={cn("ui-dropdown-item", className)} {...props} />
  );
}
