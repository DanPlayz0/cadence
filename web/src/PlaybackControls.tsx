// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Volume2, VolumeX } from "lucide-react";
import type { Quality } from "./player";
import { volumeLabel } from "./volume";

const qualities: { value: Quality; label: string; detail: string }[] = [
  { value: "auto", label: "Auto", detail: "Original audio when supported" },
  { value: "high", label: "High", detail: "MP3 · 320 kbps" },
  { value: "saver", label: "Saver", detail: "MP3 · 128 kbps" },
];

export function QualitySelect({
  value,
  onChange,
  compact = false,
}: {
  value: Quality;
  onChange: (value: Quality) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function choose(next: Quality) {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      className={`quality-select ${compact ? "compact" : ""}`}
      ref={root}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="quality-trigger"
        ref={trigger}
        aria-label={`Playback quality: ${qualities.find((q) => q.value === value)?.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>
          {qualities.find((q) => q.value === value)?.label}
          {!compact && (
            <small>{qualities.find((q) => q.value === value)?.detail}</small>
          )}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          id={id}
          className="quality-options"
          role="listbox"
          aria-label="Playback quality"
          ref={list}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button",
              ),
            ];
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
            const match = qualities.findIndex((q) =>
              q.label.toLowerCase().startsWith(event.key.toLowerCase()),
            );
            if (event.key.length === 1 && match >= 0) items[match]?.focus();
          }}
        >
          {qualities.map((q) => (
            <button
              key={q.value}
              role="option"
              aria-selected={value === q.value}
              tabIndex={-1}
              onClick={() => choose(q.value)}
            >
              <span>
                {q.label}
                <small>{q.detail}</small>
              </span>
              {value === q.value && <Check size={17} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function VolumeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const lastVolume = useRef(value || 0.8);
  if (value > 0) lastVolume.current = value;
  return (
    <div className="volume-control">
      <button
        aria-label={value === 0 ? "Unmute" : "Mute"}
        onClick={() => onChange(value === 0 ? lastVolume.current : 0)}
      >
        {value === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      <div
        className="volume-range"
        style={{ "--volume-position": `${value * 100}%` } as CSSProperties}
      >
        <span className="volume-popup" aria-hidden="true">
          {volumeLabel(value)}
        </span>
        <input
          aria-label="Volume"
          aria-valuetext={volumeLabel(value)}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </div>
  );
}
