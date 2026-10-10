// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, type RefObject } from "react";

export function usePopoverDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  panel?: RefObject<HTMLElement | null>,
) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        root.current &&
        !root.current.contains(event.target as Node) &&
        !panel?.current?.contains(event.target as Node)
      )
        dismiss.current();
    };
    // Safari taps can blur a focused item without focusing the next button.
    // Dismiss on an actual outside interaction, rather than a null blur target
    // that would unmount the tapped item before its click can run.
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, root, panel]);
}
