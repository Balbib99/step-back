import { Link } from 'react-router-dom';
import { DEFAULT_TIME_ZONE, formatClock } from '../lib/format';
import { useConfig, useHealth } from '../lib/queries';
import { BellIcon } from './icons';

type Freshness = { tone: 'ok' | 'warn' | 'idle'; label: string };

/** Tells the owner how fresh the data is and whether a source is failing (docs/design.md). */
function useFreshness(): Freshness {
  const health = useHealth();
  const config = useConfig();
  if (health.isError) return { tone: 'warn', label: 'Sin conexión con el servidor' };
  if (!health.data) return { tone: 'idle', label: 'Conectando…' };
  if (health.data.status === 'degraded') return { tone: 'warn', label: 'Alguna fuente falla' };
  const timeZone = config.data?.timeZone ?? DEFAULT_TIME_ZONE;
  return { tone: 'ok', label: `Actualizado ${formatClock(health.data.time, timeZone)}` };
}

const DOT: Record<Freshness['tone'], string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  idle: 'bg-text-3',
};

export function AppBar() {
  const { tone, label } = useFreshness();
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between bg-ground px-4 pt-3.5 pb-2.5">
      <span className="voice-number text-2xl tracking-wide">step-back</span>
      <div className="flex items-center gap-1">
        <span role="status" className="flex items-center gap-1.5 text-xs text-text-3">
          <span aria-hidden="true" className={`size-[7px] rounded-full ${DOT[tone]}`} />
          {label}
        </span>
        <Link
          to="/ajustes"
          aria-label="Ajustes y notificaciones"
          className="-mr-2 grid size-11 place-items-center text-text-2"
        >
          <BellIcon />
        </Link>
      </div>
    </header>
  );
}
