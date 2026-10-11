// SPDX-License-Identifier: GPL-2.0-or-later
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { useRef, type CSSProperties } from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { Quality } from "../../hooks/usePlayer";
import { volumeLabel } from "../../lib/volume";
import { Select, SelectItem } from "../ui/select";

const qualities: { value: Quality; label: string; detail: string }[] = [
  { value: "auto", label: "Auto", detail: "Original audio when supported" },
  {
    value: "lossless",
    label: "Lossless",
    detail: "FLAC · ALAC · PCM originals",
  },
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
  return (
    <div className={`quality-select ${compact ? "compact" : ""}`}>
      <Select
        className="quality-trigger"
        aria-label="Playback quality"
        value={value}
        displayValue={
          <span>
            {qualities.find((quality) => quality.value === value)?.label}
            {!compact && (
              <small>
                {qualities.find((quality) => quality.value === value)?.detail}
              </small>
            )}
          </span>
        }
        onChange={(event) => onChange(event.target.value as Quality)}
      >
        {qualities.map((quality) => (
          <SelectItem
            key={quality.value}
            value={quality.value}
            textValue={quality.label}
          >
            <span>
              {quality.label}
              <small>{quality.detail}</small>
            </span>
          </SelectItem>
        ))}
      </Select>
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
      <Button
        variant="ghost"
        aria-label={value === 0 ? "Unmute" : "Mute"}
        onClick={() => onChange(value === 0 ? lastVolume.current : 0)}
      >
        {value === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </Button>
      <div
        className="volume-range"
        style={{ "--volume-position": `${value * 100}%` } as CSSProperties}
      >
        <span className="volume-popup" aria-hidden="true">
          {volumeLabel(value)}
        </span>
        <Slider
          aria-label="Volume"
          aria-valuetext={volumeLabel(value)}

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
