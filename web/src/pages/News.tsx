import { onDarkColor } from '@step-back/shared';
import { useSearchParams } from 'react-router-dom';
import { ChipGroup, ChipRow, type ChipOption } from '../components/Chips';
import { NewsCard } from '../components/NewsCard';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { DEFAULT_TIME_ZONE } from '../lib/format';
import type { NewsFilters } from '../lib/news';
import { useConfig, useNews, useTeams } from '../lib/queries';

// The address keeps the view (/noticias?equipo=LAL&tipo=videos&idioma=es&jugador=LeBron%20James),
// so going back or reloading returns to the same place. Defaults are left out of it.

type TeamScope = 'mis' | 'todos' | string;

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando noticias" role="status" className="grid gap-3">
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

export function News() {
  const [params, setParams] = useSearchParams();
  const config = useConfig();
  const teams = useTeams();

  const timeZone = config.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const favorites = config.data?.favoriteTeams ?? [];

  const wantedScope: TeamScope = params.get('equipo') ?? 'mis';
  // Without configured favourites there is nothing for "Mis equipos" to show.
  const scope: TeamScope = wantedScope === 'mis' && favorites.length === 0 ? 'todos' : wantedScope;
  const video = params.get('tipo') === 'videos';
  const spanish = params.get('idioma') === 'es';
  const player = params.get('jugador') ?? undefined;

  const update = (
    changes: Record<string, string | undefined>,
    fallbacks: Record<string, string> = {},
  ) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined || value === fallbacks[key]) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };

  const filters: NewsFilters = {
    teams: scope === 'mis' ? favorites : scope === 'todos' ? [] : [scope],
    player,
    lang: spanish ? 'es' : undefined,
    video,
  };
  const news = useNews(filters);

  const teamsByAbbr = new Map((teams.data?.teams ?? []).map((t) => [t.abbr, t]));
  const items = news.data?.pages.flatMap((page) => page.news) ?? [];
  const now = new Date();

  const scopeOptions: ChipOption[] = [
    ...(favorites.length > 0 ? [{ value: 'mis', label: 'Mis equipos' }] : []),
    { value: 'todos', label: 'Todas' },
    ...favorites.map((abbr) => ({ value: abbr, label: abbr, colour: onDarkColor(abbr) })),
  ];

  const filtered = scope !== 'todos' || video || spanish || player !== undefined;
  const loading = news.isPending || config.isPending;

  return (
    <>
      <PageHeader title="Noticias" />

      <div className="mt-3">
        <ChipRow>
          <ChipGroup
            label="Equipo"
            options={scopeOptions}
            value={scope}
            onChange={(value) => update({ equipo: value ?? 'mis' }, { equipo: 'mis' })}
          />
          <ChipGroup
            label="Tipo"
            options={[{ value: 'videos', label: 'Vídeos' }]}
            value={video ? 'videos' : undefined}
            optional
            onChange={(value) => update({ tipo: value })}
          />
          <ChipGroup
            label="Idioma"
            options={[{ value: 'es', label: 'Español' }]}
            value={spanish ? 'es' : undefined}
            optional
            onChange={(value) => update({ idioma: value })}
          />
        </ChipRow>
      </div>

      {player && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-text-2">
          Noticias de <strong className="text-text">{player}</strong>
          <button
            type="button"
            aria-label={`Quitar el filtro de ${player}`}
            onClick={() => update({ jugador: undefined })}
            className="grid size-8 cursor-pointer place-items-center rounded-full border border-line bg-transparent text-text-2"
          >
            ✕
          </button>
        </p>
      )}

      <div className="mt-4">
        {loading ? (
          <Skeleton />
        ) : news.isError && items.length === 0 ? (
          <EmptyState>
            No se pudieron cargar las noticias. Comprueba que el servidor está en marcha.
            <br />
            <ActionButton onClick={() => void news.refetch()}>Reintentar</ActionButton>
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState>
            {filtered
              ? 'No hay noticias con estos filtros.'
              : 'Todavía no hay noticias. Aparecerán aquí en unos minutos.'}
            {filtered && (
              <>
                <br />
                <ActionButton onClick={() => setParams({}, { replace: true })}>
                  Ver todas las noticias
                </ActionButton>
              </>
            )}
          </EmptyState>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-3 p-0">
              {items.map((item) => (
                <li key={item.id}>
                  <NewsCard
                    item={item}
                    favorites={favorites}
                    teams={teamsByAbbr}
                    timeZone={timeZone}
                    now={now}
                    onPlayer={(name) => update({ jugador: name })}
                  />
                </li>
              ))}
            </ul>

            {news.isFetchNextPageError && (
              <p role="alert" className="mt-3 text-center text-[13px] text-text-2">
                No se pudieron cargar más noticias.
              </p>
            )}
            {news.hasNextPage && (
              <div className="mt-4 grid place-items-center">
                <button
                  type="button"
                  disabled={news.isFetchingNextPage}
                  onClick={() => void news.fetchNextPage()}
                  className="min-h-11 cursor-pointer rounded-full bg-surface-2 px-5 text-sm font-semibold text-text disabled:cursor-default disabled:opacity-60"
                >
                  {news.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
