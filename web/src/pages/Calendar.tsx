import { onDarkColor } from '@step-back/shared';
import { useSearchParams } from 'react-router-dom';
import { ChipGroup, ChipRow, type ChipOption } from '../components/Chips';
import { DayStrip } from '../components/DayStrip';
import { MiniGame } from '../components/MiniGame';
import { EmptyState, PageHeader } from '../components/PageHeader';
import {
  favouritesPlaying,
  filterGames,
  groupByDay,
  type PhaseFilter,
  type TeamFilter,
} from '../lib/calendar';
import {
  addDays,
  dayLabel,
  isValidDay,
  localDay,
  monthLabel,
  weekDays,
  weekStart,
} from '../lib/dates';
import { DEFAULT_TIME_ZONE } from '../lib/format';
import { useConfig, useGamesRange, useTeams } from '../lib/queries';

// The address keeps the view (/calendario?fecha=2026-10-07&equipo=MIN&fase=pretemporada), so
// going back or reloading returns to the same place. Defaults are left out of it.

const PHASES: ChipOption[] = [
  { value: 'pretemporada', label: 'Pretemporada' },
  { value: 'temporada', label: 'Temporada' },
];

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando partidos" role="status" className="grid gap-2">
      {[0, 1, 2].map((slot) => (
        <div key={slot} className="h-[72px] rounded-card bg-surface" />
      ))}
    </div>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 min-h-10 cursor-pointer rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text"
    >
      {children}
    </button>
  );
}

export function Calendar() {
  const [params, setParams] = useSearchParams();
  const config = useConfig();
  const teams = useTeams();

  const timeZone = config.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const favorites = config.data?.favoriteTeams ?? [];
  const today = localDay(new Date(), timeZone);

  const fecha = params.get('fecha');
  const selected = isValidDay(fecha) ? fecha : today;
  const wantedTeam: TeamFilter = params.get('equipo') ?? 'mis';
  // Without configured favourites there is nothing for "Mis equipos" to show.
  const team: TeamFilter = wantedTeam === 'mis' && favorites.length === 0 ? 'todos' : wantedTeam;
  const faseParam = params.get('fase');
  const phase: PhaseFilter =
    faseParam === 'pretemporada' || faseParam === 'temporada' ? faseParam : undefined;

  const update = (changes: { fecha?: string; equipo?: string; fase?: string | undefined }) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        const set = (key: string, value: string | undefined, fallback?: string) => {
          if (value === undefined || value === fallback) next.delete(key);
          else next.set(key, value);
        };
        if ('fecha' in changes) set('fecha', changes.fecha, today);
        if ('equipo' in changes) set('equipo', changes.equipo, 'mis');
        if ('fase' in changes) set('fase', changes.fase);
        return next;
      },
      { replace: true },
    );
  };

  const start = weekStart(selected);
  const days = weekDays(start);
  const range = useGamesRange(start, days[6]!);

  const teamsByAbbr = new Map((teams.data?.teams ?? []).map((t) => [t.abbr, t]));
  const byDay = groupByDay(range.data?.games ?? [], timeZone);
  const dayGames = byDay.get(selected) ?? [];
  const shown = filterGames(dayGames, { team, phase, favorites });

  const stripDays = days.map((day) => ({
    day,
    dots: favouritesPlaying(byDay.get(day) ?? [], favorites).map((abbr) => onDarkColor(abbr)),
  }));

  const teamOptions: ChipOption[] = [
    ...(favorites.length > 0 ? [{ value: 'mis', label: 'Mis equipos' }] : []),
    { value: 'todos', label: 'Todos' },
    ...favorites.map((abbr) => ({ value: abbr, label: abbr, colour: onDarkColor(abbr) })),
  ];

  const loading = range.isPending || config.isPending;

  return (
    <>
      <PageHeader title="Calendario" subtitle={monthLabel(selected)} sources={['games']} />

      <div className="mt-3 mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Semana anterior"
          onClick={() => update({ fecha: addDays(selected, -7) })}
          className="grid size-11 cursor-pointer place-items-center rounded-full border border-line bg-transparent text-xl text-text-2"
        >
          ‹
        </button>
        {selected !== today && (
          <button
            type="button"
            aria-label="Ir a hoy"
            onClick={() => update({ fecha: today })}
            className="min-h-10 cursor-pointer rounded-full bg-surface-2 px-4 text-sm font-semibold text-text"
          >
            Hoy
          </button>
        )}
        <button
          type="button"
          aria-label="Semana siguiente"
          onClick={() => update({ fecha: addDays(selected, 7) })}
          className="grid size-11 cursor-pointer place-items-center rounded-full border border-line bg-transparent text-xl text-text-2"
        >
          ›
        </button>
      </div>

      <DayStrip
        days={stripDays}
        selected={selected}
        today={today}
        onSelect={(day) => update({ fecha: day })}
      />

      <div className="mt-3">
        <ChipRow>
          <ChipGroup
            label="Equipo"
            options={teamOptions}
            value={team}
            onChange={(value) => update({ equipo: value ?? 'mis' })}
          />
          <ChipGroup
            label="Fase de la temporada"
            options={PHASES}
            value={phase}
            optional
            onChange={(value) => update({ fase: value })}
          />
        </ChipRow>
      </div>

      <h2 className="voice-name mt-5 mb-2.5 text-[17px] text-text-2">
        {dayLabel(selected)}
        {selected === today && <span className="ml-2 text-sm font-medium text-text-3">Hoy</span>}
      </h2>

      {loading ? (
        <Skeleton />
      ) : range.isError ? (
        <EmptyState>
          No se pudo cargar el calendario. Comprueba que el servidor está en marcha.
          <br />
          <ActionButton onClick={() => void range.refetch()}>Reintentar</ActionButton>
        </EmptyState>
      ) : shown.length > 0 ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {shown.map((game) => (
            <li key={game.id}>
              <MiniGame game={game} teams={teamsByAbbr} favorites={favorites} timeZone={timeZone} />
            </li>
          ))}
        </ul>
      ) : dayGames.length === 0 ? (
        <EmptyState>No hay partidos este día.</EmptyState>
      ) : team !== 'todos' &&
        filterGames(dayGames, { team, phase: undefined, favorites }).length === 0 ? (
        <EmptyState>
          {team === 'mis' ? 'Tus equipos no juegan este día.' : `${team} no juega este día.`} Hay{' '}
          {dayGames.length} {dayGames.length === 1 ? 'partido' : 'partidos'} en total.
          <br />
          <ActionButton onClick={() => update({ equipo: 'todos' })}>Ver todos</ActionButton>
        </EmptyState>
      ) : (
        <EmptyState>
          No hay partidos de esta fase este día.
          <br />
          <ActionButton onClick={() => update({ fase: undefined })}>
            Quitar filtro de fase
          </ActionButton>
        </EmptyState>
      )}
    </>
  );
}
