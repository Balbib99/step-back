import type { Game, GameTeam, TeamWithCrest } from '@step-back/shared';
import { gameLabel, gameStatusText, phaseLabel } from '../lib/game-text';
import { teamStyle } from '../lib/team-style';
import { ScoreNumber } from './ScoreNumber';
import { TeamCrest } from './TeamCrest';

function Lane({
  side,
  team,
  showScore,
  lost,
}: {
  side: GameTeam;
  team: TeamWithCrest | undefined;
  showScore: boolean;
  lost: boolean;
}) {
  return (
    <div
      data-team={side.abbr}
      data-chest={side.abbr}
      style={teamStyle(side.abbr)}
      className="team-field team-chest grid min-h-[76px] grid-cols-[44px_1fr_auto] items-center gap-3 px-3.5 py-3"
    >
      <TeamCrest abbr={side.abbr} src={team?.crestUrl} size={44} />
      <div className="relative z-[1] min-w-0">
        <div className="voice-name text-[21px]">{side.name}</div>
        {side.record && <div className="mt-0.5 text-xs font-medium opacity-80">{side.record}</div>}
      </div>
      {showScore && (
        <ScoreNumber
          value={side.score}
          className={`voice-number team-numeral relative z-[1] min-w-[2.2ch] text-right text-[56px] ${
            lost ? 'opacity-75' : ''
          }`}
        />
      )}
    </div>
  );
}

/**
 * A game as two jerseys: each team in its own colours with its crest, name, record and score.
 * Visitor above, home below, the second team's trim colour between them (docs/design.md).
 */
export function GameCard({
  game,
  teams,
  timeZone,
}: {
  game: Game;
  teams: ReadonlyMap<string, TeamWithCrest>;
  timeZone: string;
}) {
  const { main, live } = gameStatusText(game, timeZone);
  const started = game.status === 'live' || game.status === 'final';
  const final = game.status === 'final';

  return (
    <article
      aria-label={gameLabel(game, main)}
      className="mb-3.5 overflow-hidden rounded-card bg-surface"
    >
      <div className="flex items-center justify-between px-3.5 py-2 text-[13px] font-semibold text-text-2">
        <span>{phaseLabel(game.seasonType, true)}</span>
        <span
          className={`flex items-center gap-1.5 uppercase ${live ? 'font-bold text-text' : ''}`}
        >
          {live && (
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-live shadow-[0_0_0_3px_rgb(255_59_48/0.25)]"
            />
          )}
          {main}
        </span>
      </div>
      <Lane
        side={game.away}
        team={teams.get(game.away.abbr)}
        showScore={started}
        lost={final && game.away.winner === false}
      />
      <div
        aria-hidden="true"
        data-team={game.home.abbr}
        style={teamStyle(game.home.abbr)}
        className="team-trim h-1"
      />
      <Lane
        side={game.home}
        team={teams.get(game.home.abbr)}
        showScore={started}
        lost={final && game.home.winner === false}
      />
      {game.venue && <div className="px-3.5 py-2 text-xs text-text-3">{game.venue}</div>}
    </article>
  );
}
