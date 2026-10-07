import {
  NEUTRAL_PALETTE,
  onDarkColor,
  type Game,
  type GameTeam,
  type TeamWithCrest,
} from '@step-back/shared';
import { Link } from 'react-router-dom';
import { gameLabel, gameStatusText } from '../lib/game-text';
import { ScoreNumber } from './ScoreNumber';
import { TeamCrest } from './TeamCrest';

function Side({
  side,
  team,
  dim,
  showScore,
}: {
  side: GameTeam;
  team: TeamWithCrest | undefined;
  dim: boolean;
  showScore: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <TeamCrest abbr={side.abbr} src={team?.crestUrl} size={26} />
      <span className="voice-name min-w-0 flex-1 truncate text-base font-semibold">
        {team?.shortName ?? side.name}
      </span>
      {showScore && (
        <ScoreNumber
          value={side.score}
          className={`voice-number text-[22px] ${dim ? 'opacity-75' : ''}`}
        />
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
  teams: ReadonlyMap<string, TeamWithCrest>;
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

  return (
    <Link
      to={`/partido/${encodeURIComponent(game.id)}`}
      aria-label={`Ver el partido: ${gameLabel(game, main)}`}
      className="block text-inherit no-underline"
    >
      <article
        aria-label={gameLabel(game, main)}
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
    </Link>
  );
}
