import type { Game, PlayerLine, TeamBoxscore } from '@step-back/shared';
import { onDarkColor } from '@step-back/shared';
import { Fragment, useState } from 'react';
import {
  contribution,
  detailParts,
  shootingParts,
  reasonLabel,
  stat,
  topScore,
} from '../lib/boxscore';
import { useBoxscore } from '../lib/queries';
import { teamStyle } from '../lib/team-style';
import { ChipGroup } from './Chips';
import { EmptyState } from './PageHeader';
import { PlayerFace } from './PlayerFace';

const SECTION_TITLE = 'voice-name mt-7 mb-2.5 text-xl';
const GROUP_TITLE =
  'mt-4 mb-2 flex items-baseline justify-between text-[12px] font-semibold text-text-3';

// The colours of the three parts of a bench player's bar. Points take the team's own colour.
const REBOUNDS = '#6aa8ff';
const ASSISTS = 'var(--color-ok)';

/** Pieces of a line joined by dots, so a line that does not fit breaks between pieces, never inside one. */
function Dotted({ parts }: { parts: readonly string[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part + index}>
          {index > 0 && ' · '}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div>
      <span className="block text-[10.5px] font-semibold tracking-[0.02em] text-text-3">
        {label}
      </span>
      <b className="voice-name text-[15px] [font-variant-numeric:tabular-nums]">{stat(value)}</b>
    </div>
  );
}

/** A starter: his photo on the team's colour, his points, and the other numbers that matter. */
function StarterCard({
  player,
  abbr,
  best,
  wide,
  more,
}: {
  player: PlayerLine;
  abbr: string;
  best: number | null;
  wide: boolean;
  more: boolean;
}) {
  return (
    <article
      aria-label={player.name}
      className={`overflow-hidden rounded-card bg-surface ${
        wide ? 'grid grid-cols-[42%_1fr]' : ''
      }`}
    >
      <div
        style={teamStyle(abbr)}
        className={`team-field relative overflow-hidden ${wide ? 'min-h-[112px]' : 'h-[104px]'}`}
      >
        {player.jersey && (
          <span
            aria-hidden="true"
            className="voice-number absolute -top-2.5 -right-1 text-[92px] opacity-[0.12]"
          >
            {player.jersey}
          </span>
        )}
        <PlayerFace
          player={player}
          imageClassName="absolute bottom-0 left-1/2 h-[96%] w-auto max-w-none -translate-x-1/2"
          initialsClassName="absolute inset-x-0 bottom-0 h-3/5 text-[38px] opacity-85"
        />
        {player.position && (
          <span className="absolute top-2 left-2 rounded-[5px] bg-black/30 px-1.5 py-0.5 text-[11px] font-extrabold">
            {player.position}
          </span>
        )}
        {best !== null && player.points === best && (
          <span className="absolute top-2 right-2 rounded-[5px] bg-[#ffd24a] px-1.5 py-0.5 text-[11px] font-extrabold text-[#111]">
            ★ MÁX
          </span>
        )}
      </div>
      <div className="px-2.5 pt-2 pb-2.5">
        <h4 className="voice-name text-[17px]">{player.shortName}</h4>
        <p className="mt-1.5 mb-2 flex items-baseline gap-1.5">
          <b className="voice-number text-[34px]">{stat(player.points)}</b>
          <span className="text-[11px] font-bold text-text-3">PTS</span>
          <span className="ml-auto text-[12px] text-text-2 [font-variant-numeric:tabular-nums]">
            {stat(player.minutes)} min
          </span>
        </p>
        <div className="grid grid-cols-5 border-t border-line pt-2 text-center">
          <Stat label="REB" value={player.rebounds} />
          <Stat label="AST" value={player.assists} />
          <Stat label="ROB" value={player.steals} />
          <Stat label="TAP" value={player.blocks} />
          <Stat label="PER" value={player.turnovers} />
        </div>
        {more && (
          <p className="mt-2 text-center text-[11px] text-text-3">
            <Dotted parts={detailParts(player)} />
          </p>
        )}
      </div>
    </article>
  );
}

/** A bench player: a row with his face, a bar that compares him with his bench, and his points. */
function BenchRow({
  player,
  abbr,
  accent,
  biggest,
  best,
  more,
}: {
  player: PlayerLine;
  abbr: string;
  accent: string;
  biggest: number;
  best: number | null;
  more: boolean;
}) {
  const share = (value: number | null) => `${((value ?? 0) / biggest) * 100}%`;
  return (
    <li
      aria-label={player.name}
      className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-card bg-surface px-3 py-2.5"
    >
      <div
        style={teamStyle(abbr)}
        className="team-field relative size-[38px] overflow-hidden rounded-full"
      >
        <PlayerFace
          player={player}
          imageClassName="absolute bottom-[-2px] left-1/2 h-[110%] w-auto max-w-none -translate-x-1/2"
          initialsClassName="size-full text-[13px]"
        />
      </div>
      <div className="min-w-0">
        <p className="voice-name text-[15px]">
          {player.shortName}
          {best !== null && player.points === best && (
            <span className="ml-1.5 rounded-[5px] bg-[#ffd24a] px-1.5 py-0.5 text-[10px] font-extrabold text-[#111]">
              ★ MÁX
            </span>
          )}
          <span className="ml-1.5 text-[11px] font-semibold text-text-3">
            {[player.position, `${stat(player.minutes)} min`].filter(Boolean).join(' · ')}
          </span>
        </p>
        <div aria-hidden="true" className="my-1.5 flex h-2 overflow-hidden rounded bg-surface-2">
          <i style={{ width: share(player.points), background: accent }} />
          <i style={{ width: share(player.rebounds), background: REBOUNDS }} />
          <i style={{ width: share(player.assists), background: ASSISTS }} />
        </div>
        <p className="text-[11px] text-text-3">
          <Dotted
            parts={[
              `REB ${stat(player.rebounds)}`,
              `AST ${stat(player.assists)}`,
              `ROB ${stat(player.steals)}`,
              `TAP ${stat(player.blocks)}`,
              `PER ${stat(player.turnovers)}`,
            ]}
          />
        </p>
        {more && (
          <p className="mt-0.5 text-[11px] text-text-3">
            <Dotted parts={detailParts(player)} />
          </p>
        )}
      </div>
      <p className="voice-number text-right text-[26px]">
        {stat(player.points)}
        <small className="voice-name mt-0.5 block text-[10px] font-bold text-text-3">PTS</small>
      </p>
    </li>
  );
}

function Legend({ accent }: { accent: string }) {
  const item = (colour: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <i aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: colour }} />
      {label}
    </span>
  );
  return (
    <p className="mb-2 flex gap-3 text-[11px] text-text-3">
      {item(accent, 'Puntos')}
      {item(REBOUNDS, 'Rebotes')}
      {item(ASSISTS, 'Asistencias')}
    </p>
  );
}

function TeamStats({
  team,
  teamName,
  more,
}: {
  team: TeamBoxscore;
  teamName: string;
  more: boolean;
}) {
  const played = team.players.filter((p) => p.played);
  const starters = played.filter((p) => p.starter);
  const bench = played.filter((p) => !p.starter);
  const absent = team.players.filter((p) => !p.played);
  const best = topScore(played);
  const accent = onDarkColor(team.abbr);
  const biggest = Math.max(1, ...bench.map(contribution));
  const { totals } = team;

  return (
    <div aria-label={`Estadísticas de ${teamName}`} role="group">
      {starters.length > 0 && (
        <>
          <h3 className={GROUP_TITLE}>Quinteto titular</h3>
          <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0">
            {starters.map((p, index) => {
              const wide = starters.length % 2 === 1 && index === starters.length - 1;
              return (
                <li key={p.id} className={wide ? 'col-span-2' : ''}>
                  <StarterCard player={p} abbr={team.abbr} best={best} wide={wide} more={more} />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {bench.length > 0 && (
        <>
          <h3 className={GROUP_TITLE}>
            <span>Banquillo</span>
            <span>{bench.length} jugadores</span>
          </h3>
          <Legend accent={accent} />
          <ul aria-label="Banquillo" className="m-0 grid list-none gap-2 p-0">
            {bench.map((p) => (
              <BenchRow
                key={p.id}
                player={p}
                abbr={team.abbr}
                accent={accent}
                biggest={biggest}
                best={best}
                more={more}
              />
            ))}
          </ul>
        </>
      )}

      <p className="mt-3 rounded-card bg-surface px-3 py-2.5 text-[12px] text-text-2 [font-variant-numeric:tabular-nums]">
        <span className="font-semibold text-text">Equipo</span> ·{' '}
        <Dotted
          parts={[
            `${stat(totals.points)} PTS`,
            `${stat(totals.rebounds)} REB`,
            `${stat(totals.assists)} AST`,
            `${stat(totals.steals)} ROB`,
            `${stat(totals.blocks)} TAP`,
            `${stat(totals.turnovers)} PER`,
            ...(more ? shootingParts(totals) : []),
          ]}
        />
      </p>

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
    </div>
  );
}

/** The player numbers of a game that has started: one team at a time, so it stays readable on a phone. */
export function Boxscore({ game, favorites }: { game: Game; favorites: readonly string[] }) {
  const started = game.status === 'live' || game.status === 'final';
  const query = useBoxscore(game.id, started, game.status === 'live');
  const [chosen, setChosen] = useState<string>();
  const [more, setMore] = useState(false);

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
          <div className="flex items-center justify-between gap-3">
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
            <button
              type="button"
              aria-pressed={more}
              onClick={() => setMore((value) => !value)}
              className={`min-h-10 shrink-0 cursor-pointer rounded-full border px-3.5 text-[13px] font-semibold ${
                more ? 'border-text bg-text text-ground' : 'border-line bg-transparent text-text-2'
              }`}
            >
              Más datos
            </button>
          </div>
          {team && <TeamStats team={team} teamName={names[current] ?? current} more={more} />}
          {game.status === 'live' && (
            <p className="mt-2.5 text-[12px] text-text-3">Se actualiza cada medio minuto.</p>
          )}
        </>
      )}
    </section>
  );
}
