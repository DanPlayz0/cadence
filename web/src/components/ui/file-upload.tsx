import type { ComponentProps } from "react";
// Visible upload actions use Button; this hidden field preserves the platform picker.
export function FileUpload(
  props: Omit<ComponentProps<"input">, "type" | "hidden">,
) {
  return <input {...props} type="file" hidden />;
}
