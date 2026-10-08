import { onDarkColor, type StandingEntry, type TeamWithCrest } from '@step-back/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { ChipGroup, type ChipOption } from '../components/Chips';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { TeamCrest } from '../components/TeamCrest';
import {
  CONFERENCE_NAME,
  CONFERENCE_PARAM,
  conferenceFromParam,
  defaultConference,
  orDash,
  seasonLabel,
  zoneOf,
  type Zone,
} from '../lib/standings';
import { useConfig, useStandings, useTeams } from '../lib/queries';

// The address keeps the conference (/clasificacion?conferencia=oeste). The default is the one
// where the first favourite plays, and it is left out of the address.

const COLUMNS = 'grid-cols-[22px_minmax(0,1fr)_50px_46px_46px]';

const ZONE_COLOUR: Record<Zone, string> = {
  playoffs: 'var(--color-ok)',
  playin: 'var(--color-warn)',
  out: 'transparent',
};

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando clasificación" role="status" className="grid gap-1">
      {Array.from({ length: 8 }, (_, slot) => (
        <div key={slot} className="h-[52px] rounded-card bg-surface" />
      ))}
    </div>
  );
}

/** Two values one above the other, right aligned, so a narrow phone fits six columns of numbers. */
function Stacked({
  top,
  bottom,
  topClass = 'text-[13px] text-text-2',
  bottomClass = '',
}: {
  top: string;
  bottom: string;
  topClass?: string;
  bottomClass?: string;
}) {
  return (
    <span className="text-right tabular-nums">
      <span className={`block ${topClass}`}>{top}</span>
      <span className={`block text-[12px] text-text-3 ${bottomClass}`}>{bottom}</span>
    </span>
  );
}

function Row({
  entry,
  team,
  favourite,
  zone,
}: {
  entry: StandingEntry;
  team: TeamWithCrest | undefined;
  favourite: boolean;
  zone: Zone | undefined;
}) {
  const colour = favourite ? onDarkColor(entry.abbr) : undefined;
  const record = `${entry.wins}-${entry.losses}`;
  return (
    <li
      aria-label={`${entry.rank}. ${team?.name ?? entry.name}, ${record}`}
      data-favourite={favourite || undefined}
      data-zone={zone}
      style={{
        borderLeftColor: zone ? ZONE_COLOUR[zone] : 'transparent',
        background: colour
          ? `color-mix(in srgb, ${colour} 16%, var(--color-surface))`
          : 'var(--color-surface)',
      }}
      className={`grid ${COLUMNS} min-h-[52px] items-center gap-x-2 rounded-card border-l-[4px] py-1.5 pr-3 pl-2.5`}
    >
      <span className="voice-number text-base text-text-2 tabular-nums">{entry.rank}</span>
      <Link
        to={`/equipo/${entry.abbr}`}
        aria-label={`Ver ${team?.name ?? entry.name}`}
        className="flex min-w-0 items-center gap-2 text-inherit no-underline"
      >
        <TeamCrest abbr={entry.abbr} src={team?.crestUrl} size={26} />
        <span
          className={`voice-name min-w-0 truncate text-[15px] ${favourite ? 'font-bold' : 'font-semibold'}`}
        >
          {team?.shortName ?? entry.name}
        </span>
      </Link>
      <Stacked
        top={record}
        bottom={entry.winPct.toFixed(3).replace(/^0/, '')}
        topClass="voice-name text-[15px]"
      />
      <Stacked top={orDash(entry.home)} bottom={orDash(entry.road)} />
      <Stacked
        top={orDash(entry.last10)}
        bottom={orDash(entry.streak)}
        bottomClass={entry.streak?.startsWith('W') ? 'text-ok font-semibold' : 'font-semibold'}
      />
    </li>
  );
}

function Legend() {
  const item = (colour: string, text: string) => (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className="h-3 w-1 rounded-sm" style={{ background: colour }} />
      {text}
    </span>
  );
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-3">
      {item(ZONE_COLOUR.playoffs, 'Playoffs (1-6)')}
      {item(ZONE_COLOUR.playin, 'Play-in (7-10)')}
    </p>
  );
}

export function Standings() {
  const [params, setParams] = useSearchParams();
  const config = useConfig();
  const teams = useTeams();
  const standings = useStandings();

  const favorites = config.data?.favoriteTeams ?? [];
  const tables = standings.data?.standings ?? [];
  const wanted = conferenceFromParam(params.get('conferencia'));
  const conference = wanted ?? defaultConference(tables, favorites);
  const table = tables.find((t) => t.conference === conference);

  const select = (value: string | undefined) => {
    if (!value) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === CONFERENCE_PARAM[defaultConference(tables, favorites)])
          next.delete('conferencia');
        else next.set('conferencia', value);
        return next;
      },
      { replace: true },
    );
  };

  const options: ChipOption[] = (['east', 'west'] as const).map((c) => ({
    value: CONFERENCE_PARAM[c],
    label: CONFERENCE_NAME[c],
  }));

  const teamsByAbbr = new Map((teams.data?.teams ?? []).map((t) => [t.abbr, t]));
  const preseason = table?.seasonType === 'preseason';
  const loading = standings.isPending || config.isPending;

  return (
    <>
      <PageHeader
        title="Clasificación"
        sources={['standings']}
        subtitle={table ? `Temporada ${seasonLabel(table.season)}` : undefined}
      />

      <div className="mt-3">
        <ChipGroup
          label="Conferencia"
          options={options}
          value={CONFERENCE_PARAM[conference]}
          onChange={select}
        />
      </div>

      {loading ? (
        <div className="mt-4">
          <Skeleton />
        </div>
      ) : standings.isError ? (
        <EmptyState>
          No se pudo cargar la clasificación. Comprueba que el servidor está en marcha.
          <br />
          <button
            type="button"
            onClick={() => void standings.refetch()}
            className="mt-3 min-h-10 cursor-pointer rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text"
          >
            Reintentar
          </button>
        </EmptyState>
      ) : !table ? (
        <EmptyState>
          Todavía no se ha descargado la clasificación. Aparecerá aquí en unos minutos.
        </EmptyState>
      ) : (
        <>
          {preseason && (
            <p
              role="note"
              className="mt-4 rounded-card border border-warn/40 bg-surface p-3 text-[13px] text-text-2"
            >
              <strong className="text-text">Clasificación de pretemporada.</strong> Cuenta solo los
              amistosos, no es la oficial. Los equipos empatados comparten posición.
            </p>
          )}

          <div
            aria-hidden="true"
            className={`mt-4 grid ${COLUMNS} gap-x-2 pr-3 pl-[14px] text-[11px] text-text-3`}
          >
            <span>#</span>
            <span>Equipo</span>
            <span className="text-right">
              V-D
              <br />%
            </span>
            <span className="text-right">
              Casa
              <br />
              Fuera
            </span>
            <span className="text-right">
              Últ. 10
              <br />
              Racha
            </span>
          </div>

          <ol
            aria-label={`Clasificación del ${CONFERENCE_NAME[conference]}`}
            className="m-0 mt-1 grid list-none gap-1 p-0"
          >
            {table.entries.map((entry) => (
              <Row
                key={entry.teamId}
                entry={entry}
                team={teamsByAbbr.get(entry.abbr)}
                favourite={favorites.includes(entry.abbr)}
                zone={preseason ? undefined : zoneOf(entry.rank)}
              />
            ))}
          </ol>

          {!preseason && <Legend />}
        </>
      )}
    </>
  );
}
