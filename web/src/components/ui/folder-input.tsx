import { useEffect, useId, useState, type ComponentProps } from "react";
import { useControl } from "./useControl";
import { Input } from "./input";
import { Button } from "./button";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
export function FolderInput({
  options,
  value,
  onChange,
  ...props
}: ComponentProps<typeof Input> & { options: string[] }) {
  const [open, setOpen] = useState(false);
  const control = useControl<HTMLDivElement>(props.disabled);
  useEffect(() => {
    if (control.disabled) setOpen(false);
  }, [control.disabled]);
  const id = useId();
  const matches = options.filter((option) =>
    option.toLowerCase().includes(String(value || "").toLowerCase()),
  );
  return (
    <div className="ui-folder-input" ref={control.ref}>
      <Input {...props} value={value} onChange={onChange} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={control.disabled || !options.length}
            aria-label="Choose a mounted folder"
          >
            Browse
          </Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Mounted folders">
          <div id={id} className="ui-folder-options">
            {matches.length ? (
              matches.map((option) => (
                <Button
                  key={option}
                  variant="ghost"
                  type="button"
                  disabled={control.disabled}
                  onClick={() => {
                    onChange?.({
                      target: { value: option },
                      currentTarget: { value: option },
                    } as Parameters<NonNullable<typeof onChange>>[0]);
                    setOpen(false);
                  }}
                >
                  {option}
                </Button>
              ))
            ) : (
              <p>No matching mounted folders.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
