import type { Game } from '@step-back/shared';
import { Link } from 'react-router-dom';
import { dayLabel, localDay } from '../lib/dates';
import { formatClock } from '../lib/format';
import { TeamBadge } from './TeamBadge';

/** "Tu equipo juega el jue 8 oct a las 01:00 contra Indiana Pacers." */
export function NextGameRow({
  abbr,
  game,
  timeZone,
}: {
  abbr: string;
  /** Undefined when the team has nothing scheduled in the period looked at. */
  game: Game | undefined;
  timeZone: string;
}) {
  if (!game) {
    return (
      <div className="flex items-center gap-3 rounded-card bg-surface px-3.5 py-3">
        <TeamBadge abbr={abbr} />
        <span className="text-sm text-text-2">
          Sin partidos programados en las próximas 2 semanas.
        </span>
      </div>
    );
  }

  const home = game.home.abbr === abbr;
  const opponent = home ? game.away : game.home;
  const when = `${dayLabel(localDay(game.startUtc, timeZone))} · ${formatClock(game.startUtc, timeZone)}`;

  return (
    <div className="flex items-center gap-3 rounded-card bg-surface px-3.5 py-3">
      <Link to={`/equipo/${abbr}`} aria-label={`Ver ${abbr}`} className="text-inherit no-underline">
        <TeamBadge abbr={abbr} />
      </Link>
      <Link
        to={`/partido/${encodeURIComponent(game.id)}`}
        className="min-w-0 text-sm text-inherit no-underline"
      >
        <span className="voice-name block text-base">{when}</span>
        <span className="block truncate text-text-2">
          {home ? 'vs' : 'en'} {opponent.name}
        </span>
      </Link>
    </div>
  );
}
