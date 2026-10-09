// SPDX-License-Identifier: GPL-2.0-or-later
import { useRef, type PointerEvent } from "react";

// Native dialog backdrops target the dialog itself; padding and scrollbars do too.
// Require both ends of the gesture to be outside to avoid dismissing a drag.
export function useDialogDismiss(busy = false) {
  const pointer = useRef<number | null>(null);
  function outside(event: PointerEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    );
  }
  return {
    onPointerDown(event: PointerEvent<HTMLDialogElement>) {
      pointer.current =
        !busy && event.isPrimary && event.button === 0 && outside(event)
          ? event.pointerId
          : null;
    },
    onPointerUp(event: PointerEvent<HTMLDialogElement>) {
      const dismiss =
        !busy && pointer.current === event.pointerId && outside(event);
      pointer.current = null;
      if (dismiss) event.currentTarget.close();
    },
    onPointerCancel() {
      pointer.current = null;
    },
  };
}
