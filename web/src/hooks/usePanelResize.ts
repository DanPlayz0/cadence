// SPDX-License-Identifier: GPL-2.0-or-later
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { clampPanelSize, panelBounds, type PanelMode } from "../lib/panelSize";
const defaults = { side: 360, stack: 280 };
const storageKey = "cadence.playback-panel-size";
function readSizes() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "null");
    return {
      side: Number.isFinite(value?.side) ? value.side : defaults.side,
      stack: Number.isFinite(value?.stack) ? value.stack : defaults.stack,
    };
  } catch {
    return defaults;
  }
}
export function usePanelResize(open: boolean) {
  const app = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(readSizes);
  const [layout, setLayout] = useState<{ mode: PanelMode; available: number }>({
    mode: window.innerWidth > 1100 ? "side" : "stack",
    available: 660,
  });
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    id: number;
    start: number;
    size: number;
    mode: PanelMode;
  } | null>(null);
  useLayoutEffect(() => {
    const host = app.current;
    if (!host) return;
    const footer = host.querySelector<HTMLElement>(".player");
    const measure = () => {
      const mode = window.innerWidth > 1100 ? "side" : "stack";
      const sidebar = host.querySelector<HTMLElement>(".sidebar");
      const available =
        mode === "side"
          ? host.clientWidth - (sidebar?.getBoundingClientRect().width || 235)
          : host.clientHeight - (footer?.getBoundingClientRect().height || 208);
      setLayout((previous) =>
        previous.mode === mode && previous.available === available
          ? previous
          : { mode, available },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    if (footer) observer.observe(footer);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);
  const bounds = panelBounds(layout.mode, layout.available);
  const size = expanded
    ? bounds.max
    : clampPanelSize(sizes[layout.mode], bounds);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(sizes));
    } catch {
      /* Resizing still works when storage is unavailable. */
    }
  }, [sizes]);
  function resize(next: number) {
    setExpanded(false);
    setSizes((previous) => ({
      ...previous,
      [layout.mode]: clampPanelSize(next, bounds),
    }));
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return {
    app,
    mode: layout.mode,
    size,
    bounds,
    expanded,
    dragging,
    toggleExpanded: () => setExpanded((value) => !value),
    handle: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          start: layout.mode === "side" ? event.clientX : event.clientY,
          size,
          mode: layout.mode,
        };
        setDragging(true);
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        if (current.mode !== layout.mode) {
          finish(event);
          return;
        }
        const point = layout.mode === "side" ? event.clientX : event.clientY;
        resize(current.size + current.start - point);
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture() {
        drag.current = null;
        setDragging(false);
      },
      onDoubleClick() {
        resize(defaults[layout.mode]);
      },
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const increase = layout.mode === "side" ? "ArrowLeft" : "ArrowUp";
        const decrease = layout.mode === "side" ? "ArrowRight" : "ArrowDown";
        if (![increase, decrease, "Home", "End", "Enter"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        resize(
          event.key === "Home"
            ? bounds.min
            : event.key === "End"
              ? bounds.max
              : event.key === "Enter"
                ? defaults[layout.mode]
                : size +
                  (event.key === increase ? 1 : -1) *
                    (event.shiftKey ? 80 : 20),
        );
      },
    },
  };
}
