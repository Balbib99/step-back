import { onDarkColor } from '@step-back/shared';
import { useSearchParams } from 'react-router-dom';
import { ChipGroup, ChipRow, type ChipOption } from '../components/Chips';
import { HighlightCard } from '../components/HighlightCard';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { DEFAULT_TIME_ZONE } from '../lib/format';
import { useConfig, useHighlights, useTeams } from '../lib/queries';

// The address keeps the team (/jugadas?equipo=LAL); "Mis equipos" is the default and is left out.

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando jugadas" role="status" className="grid gap-3">
      {[0, 1].map((slot) => (
        <div key={slot} className="h-[300px] rounded-card bg-surface" />
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

export function Highlights() {
  const [params, setParams] = useSearchParams();
  const config = useConfig();
  const teams = useTeams();

  const timeZone = config.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const favorites = config.data?.favoriteTeams ?? [];

  const wanted = params.get('equipo') ?? 'mis';
  // Without configured favourites there is nothing for "Mis equipos" to show.
  const scope = wanted === 'mis' && favorites.length === 0 ? 'todos' : wanted;
  const selected = scope === 'mis' ? favorites : scope === 'todos' ? [] : [scope];
  const highlights = useHighlights(selected);

  const select = (value: string | undefined) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (!value || value === 'mis') next.delete('equipo');
        else next.set('equipo', value);
        return next;
      },
      { replace: true },
    );
  };

  const options: ChipOption[] = [
    ...(favorites.length > 0 ? [{ value: 'mis', label: 'Mis equipos' }] : []),
    { value: 'todos', label: 'Todas' },
    ...favorites.map((abbr) => ({ value: abbr, label: abbr, colour: onDarkColor(abbr) })),
  ];

  const teamsByAbbr = new Map((teams.data?.teams ?? []).map((t) => [t.abbr, t]));
  const items = highlights.data?.pages.flatMap((page) => page.highlights) ?? [];
  const now = new Date();
  const loading = highlights.isPending || config.isPending;

  return (
    <>
      <PageHeader title="Jugadas" />

      <div className="mt-3">
        <ChipRow>
          <ChipGroup label="Equipo" options={options} value={scope} onChange={select} />
        </ChipRow>
      </div>

      <div className="mt-4">
        {loading ? (
          <Skeleton />
        ) : highlights.isError && items.length === 0 ? (
          <EmptyState>
            No se pudieron cargar las jugadas. Comprueba que el servidor está en marcha.
            <br />
            <ActionButton onClick={() => void highlights.refetch()}>Reintentar</ActionButton>
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState>
            {scope === 'todos'
              ? 'Todavía no hay jugadas. El canal de la NBA se revisa cada pocos minutos.'
              : 'Aún sin jugadas de este equipo. Los resúmenes salen un rato después de cada partido.'}
            {scope !== 'todos' && (
              <>
                <br />
                <ActionButton onClick={() => select('todos')}>Ver todas las jugadas</ActionButton>
              </>
            )}
          </EmptyState>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-3 p-0">
              {items.map((highlight) => (
                <li key={highlight.id}>
                  <HighlightCard
                    highlight={highlight}
                    favorites={favorites}
                    teams={teamsByAbbr}
                    timeZone={timeZone}
                    now={now}
                  />
                </li>
              ))}
            </ul>

            {highlights.isFetchNextPageError && (
              <p role="alert" className="mt-3 text-center text-[13px] text-text-2">
                No se pudieron cargar más jugadas.
              </p>
            )}
            {highlights.hasNextPage && (
              <div className="mt-4 grid place-items-center">
                <button
                  type="button"
                  disabled={highlights.isFetchingNextPage}
                  onClick={() => void highlights.fetchNextPage()}
                  className="min-h-11 cursor-pointer rounded-full bg-surface-2 px-5 text-sm font-semibold text-text disabled:cursor-default disabled:opacity-60"
                >
                  {highlights.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
