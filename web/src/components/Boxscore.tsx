import type { Game, PlayerLine, StatLine, TeamBoxscore } from '@step-back/shared';
import { onDarkColor } from '@step-back/shared';
import { useState } from 'react';
import { reasonLabel, signed, stat, topScore } from '../lib/boxscore';
import { useBoxscore } from '../lib/queries';
import { ChipGroup } from './Chips';
import { EmptyState } from './PageHeader';

const SECTION_TITLE = 'voice-name mt-7 mb-2.5 text-xl';

// Columns in the order a Spanish box score uses. `title` is what the abbreviation means.
const COLUMNS: { label: string; title: string; value: (line: StatLine) => string }[] = [
  { label: 'MIN', title: 'Minutos', value: (l) => stat(l.minutes) },
  { label: 'PTS', title: 'Puntos', value: (l) => stat(l.points) },
  { label: 'REB', title: 'Rebotes', value: (l) => stat(l.rebounds) },
  { label: 'AST', title: 'Asistencias', value: (l) => stat(l.assists) },
  { label: 'ROB', title: 'Robos', value: (l) => stat(l.steals) },
  { label: 'TAP', title: 'Tapones', value: (l) => stat(l.blocks) },
  { label: 'PER', title: 'Pérdidas', value: (l) => stat(l.turnovers) },
  { label: 'TC', title: 'Tiros de campo (anotados-intentados)', value: (l) => stat(l.fieldGoals) },
  { label: 'T3', title: 'Triples (anotados-intentados)', value: (l) => stat(l.threePointers) },
  { label: 'TL', title: 'Tiros libres (anotados-intentados)', value: (l) => stat(l.freeThrows) },
  {
    label: '+/-',
    title: 'Diferencia de puntos con él en pista',
    value: (l) => signed(l.plusMinus),
  },
];
const POINTS_COLUMN = 1;

const CELL = 'px-2 py-2.5 text-text-2';
const STICKY = 'sticky left-0 z-[1] bg-surface';

function PlayerRow({ player, best }: { player: PlayerLine; best: number | null }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className={`${STICKY} px-3.5 py-2.5 text-left font-medium text-text`}>
        <span className="block whitespace-nowrap text-sm">{player.shortName}</span>
        {player.position && (
          <span className="block text-[11px] text-text-3">{player.position}</span>
        )}
      </th>
      {COLUMNS.map((column, index) => (
        <td
          key={column.label}
          className={
            index === POINTS_COLUMN && best !== null && player.points === best
              ? 'px-2 py-2.5 font-bold text-text'
              : CELL
          }
        >
          {column.value(player)}
        </td>
      ))}
    </tr>
  );
}

function GroupRow({ children }: { children: string }) {
  return (
    <tr>
      <th
        scope="colgroup"
        colSpan={COLUMNS.length + 1}
        className={`${STICKY} px-3.5 pt-3 pb-1 text-left text-[12px] font-semibold text-text-3`}
      >
        {children}
      </th>
    </tr>
  );
}

function TeamTable({ team, teamName }: { team: TeamBoxscore; teamName: string }) {
  const played = team.players.filter((p) => p.played);
  const starters = played.filter((p) => p.starter);
  const bench = played.filter((p) => !p.starter);
  const absent = team.players.filter((p) => !p.played);
  const best = topScore(played);

  return (
    <>
      <div className="overflow-x-auto rounded-card bg-surface">
        <table className="w-full min-w-[540px] border-collapse text-center text-sm tabular-nums">
          <caption className="sr-only">Estadísticas de {teamName}</caption>
          <thead>
            <tr className="text-[12px] text-text-3">
              <th scope="col" className={`${STICKY} px-3.5 py-2 text-left font-medium`}>
                Jugador
              </th>
              {COLUMNS.map((column) => (
                <th key={column.label} scope="col" className="px-2 py-2 font-medium">
                  <abbr title={column.title} className="no-underline">
                    {column.label}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {starters.length > 0 && <GroupRow>Quinteto titular</GroupRow>}
            {starters.map((p) => (
              <PlayerRow key={p.id} player={p} best={best} />
            ))}
            {bench.length > 0 && <GroupRow>Banquillo</GroupRow>}
            {bench.map((p) => (
              <PlayerRow key={p.id} player={p} best={best} />
            ))}
            <tr className="voice-name border-t-2 border-line">
              <th scope="row" className={`${STICKY} px-3.5 py-2.5 text-left text-base`}>
                Total
              </th>
              {COLUMNS.map((column) => (
                <td key={column.label} className="px-2 py-2.5 text-text">
                  {column.value(team.totals)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {absent.length > 0 && (
        <p className="mt-2.5 text-[13px] text-text-3">
          <span className="font-semibold text-text-2">No han jugado:</span>{' '}
          {absent
            .map((p) => {
              const reason = reasonLabel(p.reason);
              return reason ? `${p.shortName} (${reason})` : p.shortName;
            })
            .join(', ')}
          .
        </p>
      )}
    </>
  );
}

/** The player numbers of a game that has started: one team at a time, so the table stays readable on a phone. */
export function Boxscore({ game, favorites }: { game: Game; favorites: readonly string[] }) {
  const started = game.status === 'live' || game.status === 'final';
  const query = useBoxscore(game.id, started, game.status === 'live');
  const [chosen, setChosen] = useState<string>();

  if (!started) return null;

  const { away, home } = game;
  const firstFavorite = [away.abbr, home.abbr].find((abbr) => favorites.includes(abbr));
  const current = chosen ?? firstFavorite ?? away.abbr;
  const names = { [away.abbr]: away.name, [home.abbr]: home.name };
  const data = query.data;
  const team = data ? (current === home.abbr ? data.home : data.away) : null;

  return (
    <section aria-labelledby="game-players">
      <h2 id="game-players" className={SECTION_TITLE}>
        Estadísticas de jugadores
      </h2>

      {query.isPending ? (
        <div role="status" aria-label="Cargando estadísticas" aria-busy="true">
          <div className="h-[260px] rounded-card bg-surface" />
        </div>
      ) : query.isError ? (
        <EmptyState>
          No se pudieron cargar las estadísticas.
          <br />
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-3 min-h-10 cursor-pointer rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text"
          >
            Reintentar
          </button>
        </EmptyState>
      ) : !data?.away || !data.home ? (
        <EmptyState>
          Aún no hay estadísticas de este partido. Suelen aparecer en cuanto ESPN las publica.
        </EmptyState>
      ) : (
        <>
          <div className="mb-3">
            <ChipGroup
              label="Equipo"
              value={current}
              onChange={(value) => value && setChosen(value)}
              options={[away, home].map((side) => ({
                value: side.abbr,
                label: side.abbr,
                colour: onDarkColor(side.abbr),
              }))}
            />
          </div>
          {team && <TeamTable team={team} teamName={names[current] ?? current} />}
          {game.status === 'live' && (
            <p className="mt-2.5 text-[12px] text-text-3">Se actualiza cada medio minuto.</p>
          )}
        </>
      )}
    </section>
  );
}
