export interface ChipOption {
  value: string;
  label: string;
  /** Border colour that tells which team the chip belongs to. */
  colour?: string;
}

/** One group of exclusive filter chips. Pressing the active chip of an optional group clears it. */
export function ChipGroup({
  label,
  options,
  value,
  onChange,
  optional = false,
}: {
  label: string;
  options: readonly ChipOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  optional?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-2">
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(pressed && optional ? undefined : option.value)}
            style={option.colour && !pressed ? { borderColor: option.colour } : undefined}
            className={`min-h-10 shrink-0 cursor-pointer rounded-full border px-3.5 text-sm font-semibold ${
              pressed ? 'border-text bg-text text-ground' : 'border-line bg-transparent text-text-2'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A horizontally scrollable row of chip groups. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 flex gap-4 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
      {children}
    </div>
  );
}
