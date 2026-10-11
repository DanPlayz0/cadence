import * as React from "react";
import * as Primitive from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { Button } from "./button";
import { cn } from "./utils";
export function Collapsible({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root {...props} className={cn("ui-collapsible", className)}>
      {children}
    </Primitive.Root>
  );
}
export function CollapsibleTrigger({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Primitive.Trigger asChild>
      <Button variant="ghost" type="button" className="ui-collapsible-trigger">
        {children}
        <ChevronDown size={16} />
      </Button>
    </Primitive.Trigger>
  );
}
export const CollapsibleContent = Primitive.Content;
