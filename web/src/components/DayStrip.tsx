import { dayLabel, dayOfMonth, weekdayShort } from '../lib/dates';

export interface StripDay {
  day: string;
  /** Colours of the favourite teams playing that day. */
  dots: readonly string[];
}

/**
 * The seven days of a week. The selected day is inverted, today is marked, and a dot per
 * favourite team that plays shows where the games of your teams are.
 */
export function DayStrip({
  days,
  selected,
  today,
  onSelect,
}: {
  days: readonly StripDay[];
  selected: string;
  today: string;
  onSelect: (day: string) => void;
}) {
  return (
    <div role="group" aria-label="Días de la semana" className="grid grid-cols-7 gap-1.5">
      {days.map(({ day, dots }) => {
        const isSelected = day === selected;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={isSelected}
            aria-current={day === today ? 'date' : undefined}
            aria-label={`${dayLabel(day)}${day === today ? ', hoy' : ''}${
              dots.length ? `, juegan ${dots.length} de tus equipos` : ''
            }`}
            onClick={() => onSelect(day)}
            className={`grid min-h-16 cursor-pointer justify-items-center gap-0.5 rounded-xl border pt-2 pb-1.5 ${
              isSelected
                ? 'border-text bg-text text-ground'
                : 'border-line bg-transparent text-text-2'
            }`}
          >
            <small
              className={`text-[11px] font-semibold ${isSelected ? 'text-[#3a3f4c]' : ''} ${
                day === today && !isSelected ? 'text-text' : ''
              }`}
            >
              {weekdayShort(day)}
            </small>
            <b
              className={`voice-number text-[22px] ${isSelected ? 'text-ground' : 'text-text'}`}
              style={{ lineHeight: 1 }}
            >
              {dayOfMonth(day)}
            </b>
            <span aria-hidden="true" className="flex h-1.5 gap-[3px]">
              {dots.map((colour) => (
                <i
                  key={colour}
                  className="block size-1.5 rounded-full"
                  style={{ background: colour }}
                />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
