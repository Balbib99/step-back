import {
  NEUTRAL_PALETTE,
  onDarkColor,
  type Game,
  type GameTeam,
  type Team,
} from '@step-back/shared';
import { formatClock } from '../lib/format';
import { TeamCrest } from './TeamCrest';

const PHASE_LABEL: Record<Game['seasonType'], string> = {
  preseason: 'Pretemp.',
  regular: 'Temporada',
  playoffs: 'Playoffs',
};

function periodLabel(period: number): string {
  return period <= 4 ? `Q${period}` : `PR${period - 4}`;
}

/** What the right-hand column says about a game, in Spanish. */
export function gameStatusText(
  game: Game,
  timeZone: string,
): { main: string; sub: string; live: boolean } {
  const phase = PHASE_LABEL[game.seasonType];
  switch (game.status) {
    case 'live': {
      const halftime = /half/i.test(game.statusDetail);
      const main = halftime
        ? 'Descanso'
        : [game.period ? periodLabel(game.period) : '', game.clock ?? ''].filter(Boolean).join(' ');
      return { main: main || 'En juego', sub: 'En juego', live: true };
    }
    case 'final':
      return { main: 'Final', sub: phase, live: false };
    case 'postponed':
      return { main: 'Aplazado', sub: phase, live: false };
    case 'canceled':
      return { main: 'Cancelado', sub: phase, live: false };
    default:
      return { main: formatClock(game.startUtc, timeZone), sub: phase, live: false };
  }
}

function Side({
  side,
  team,
  dim,
  showScore,
}: {
  side: GameTeam;
  team: Team | undefined;
  dim: boolean;
  showScore: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <TeamCrest abbr={side.abbr} logoUrl={team?.logoUrl} size={26} />
      <span className="voice-name min-w-0 flex-1 truncate text-base font-semibold">
        {team?.shortName ?? side.name}
      </span>
      {showScore && (
        <span
          className={`voice-number text-[22px] ${dim ? 'opacity-75' : ''}`}
          aria-label={`${side.score ?? 0} puntos`}
        >
          {side.score}
        </span>
      )}
    </span>
  );
}

/**
 * A game as a row of the calendar: a bar in the colour of the favourite team(s) playing, the two
 * teams (visitor first), and the time or result on the right.
 */
export function MiniGame({
  game,
  teams,
  favorites,
  timeZone,
}: {
  game: Game;
  teams: ReadonlyMap<string, Team>;
  favorites: readonly string[];
  timeZone: string;
}) {
  const { main, sub, live } = gameStatusText(game, timeZone);
  const started = game.status === 'live' || game.status === 'final';
  const final = game.status === 'final';
  const sides = [game.away, game.home] as const;
  const barColours = sides.map((side) =>
    favorites.includes(side.abbr) ? onDarkColor(side.abbr) : null,
  );
  const [top, bottom] = barColours;
  const bar = top && bottom ? [top, bottom] : [top ?? bottom ?? NEUTRAL_PALETTE.trim];
  const label = started
    ? `${game.away.name} ${game.away.score}, ${game.home.name} ${game.home.score}, ${main}`
    : `${game.away.name} en ${game.home.name}, ${main}`;

  return (
    <article
      aria-label={label}
      className="grid min-h-16 grid-cols-[6px_1fr_auto] overflow-hidden rounded-card bg-surface"
    >
      <span aria-hidden="true" className="flex flex-col">
        {bar.map((colour, index) => (
          <span key={index} className="flex-1" style={{ background: colour }} />
        ))}
      </span>
      <div className="grid content-center gap-1.5 px-3.5 py-2.5">
        {sides.map((side) => (
          <Side
            key={side.teamId + side.abbr}
            side={side}
            team={teams.get(side.abbr)}
            dim={final && side.winner === false}
            showScore={started}
          />
        ))}
      </div>
      <div className="grid min-w-[84px] place-items-center border-l border-line px-3.5 py-2.5 text-center">
        <span>
          <span className={`voice-name block text-lg tabular-nums ${live ? 'text-live' : ''}`}>
            {main}
          </span>
          <span className="block text-[11px] text-text-3">{sub}</span>
        </span>
      </div>
    </article>
  );
}
