import * as Primitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { Button } from "./button";
export const Tabs = Primitive.Root;
export const TabsList = Primitive.List;
export const TabsContent = Primitive.Content;
export function TabsTrigger(props: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger asChild {...props}>
      <Button type="button" variant="ghost">
        {props.children}
      </Button>
    </Primitive.Trigger>
  );
}
