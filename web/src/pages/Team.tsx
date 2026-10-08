import { isTeamAbbr, type Game, type TeamWithCrest } from '@step-back/shared';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink';
import { HighlightCard } from '../components/HighlightCard';
import { MiniGame } from '../components/MiniGame';
import { NewsCard } from '../components/NewsCard';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { TeamCrest } from '../components/TeamCrest';
import { DEFAULT_TIME_ZONE } from '../lib/format';
import {
  useConfig,
  useHighlights,
  useNews,
  useStandings,
  useTeamGames,
  useTeams,
} from '../lib/queries';
import { CONFERENCE_NAME, seasonLabel } from '../lib/standings';
import { teamStyle } from '../lib/team-style';
import { useTranslationAvailability } from '../lib/translation';

// The address keeps the tab (/equipo/MIN?pestana=jugadas); "Noticias" is the default and is left out.

type Tab = 'noticias' | 'jugadas' | 'calendario';
const TABS: { value: Tab; label: string }[] = [
  { value: 'noticias', label: 'Noticias' },
  { value: 'jugadas', label: 'Jugadas' },
  { value: 'calendario', label: 'Calendario' },
];

const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.value === value);

function MoreButton({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="mt-4 grid place-items-center">
      <button
        type="button"
        disabled={loading}
        onClick={onClick}
        className="min-h-11 cursor-pointer rounded-full bg-surface-2 px-5 text-sm font-semibold text-text disabled:cursor-default disabled:opacity-60"
      >
        {loading ? 'Cargando…' : 'Cargar más'}
      </button>
    </div>
  );
}

export function Team() {
  const params = useParams();
  const abbr = (params.abbr ?? '').toUpperCase();
  const known = isTeamAbbr(abbr);
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();

  const config = useConfig();
  const teams = useTeams();
  const standings = useStandings();
  const translation = useTranslationAvailability();

  const tabParam = search.get('pestana');
  const tab: Tab = isTab(tabParam) ? tabParam : 'noticias';

  // Each tab asks for its data only while it is open.
  const news = useNews(
    { teams: [abbr], player: undefined, lang: undefined, video: false },
    known && tab === 'noticias',
  );
  const highlights = useHighlights([abbr], known && tab === 'jugadas');
  const games = useTeamGames(abbr);

  if (!known) {
    return (
      <>
        <BackLink />
        <PageHeader title="Equipo" />
        <EmptyState>Ese equipo no existe. Usa la clasificación para encontrarlo.</EmptyState>
      </>
    );
  }

  const timeZone = config.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const favorites = config.data?.favoriteTeams ?? [];
  const teamsByAbbr = new Map((teams.data?.teams ?? []).map((t) => [t.abbr, t]));
  const team = teamsByAbbr.get(abbr);
  const now = new Date();

  const table = standings.data?.standings.find((t) => t.entries.some((e) => e.abbr === abbr));
  const entry = table?.entries.find((e) => e.abbr === abbr);
  const preseason = table?.seasonType === 'preseason';

  const select = (value: Tab) =>
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === 'noticias') next.delete('pestana');
        else next.set('pestana', value);
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <BackLink />
      <PageHeader title={team?.shortName ?? abbr} sources={['games', 'news']} />

      <section
        data-team={abbr}
        data-chest={abbr}
        style={teamStyle(abbr)}
        aria-label={team?.name ?? abbr}
        className="team-field team-chest -mx-4 mt-3 overflow-hidden"
      >
        <div className="relative z-[1] flex items-center gap-4 px-4 py-5">
          <TeamCrest abbr={abbr} src={team?.crestUrl} size={64} />
          <div className="min-w-0 flex-1">
            <p className="voice-name text-[24px]">{team?.name ?? abbr}</p>
            {entry && table && (
              <p className="mt-1 text-[13px] font-medium opacity-85">
                {preseason
                  ? `Pretemporada ${seasonLabel(table.season)}`
                  : `${entry.rank}º del ${CONFERENCE_NAME[table.conference]}`}
              </p>
            )}
          </div>
          {entry && (
            <p className="voice-number team-numeral text-[48px]" aria-label="Victorias y derrotas">
              {entry.wins}-{entry.losses}
            </p>
          )}
        </div>
        <div aria-hidden="true" className="team-trim h-1.5" />
      </section>

      <div role="tablist" aria-label="Secciones del equipo" className="mt-4 flex gap-2">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            onClick={() => select(item.value)}
            className={`min-h-10 cursor-pointer rounded-full border px-3.5 text-sm font-semibold ${
              tab === item.value
                ? 'border-text bg-text text-ground'
                : 'border-line bg-transparent text-text-2'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label} className="mt-4">
        {tab === 'noticias' && (
          <NewsTab
            query={news}
            favorites={favorites}
            teams={teamsByAbbr}
            timeZone={timeZone}
            now={now}
            translation={translation}
            onPlayer={(name) =>
              navigate(`/noticias?equipo=todos&jugador=${encodeURIComponent(name)}`)
            }
          />
        )}
        {tab === 'jugadas' && (
          <>
            {highlights.isPending ? (
              <Loading label="Cargando jugadas" />
            ) : highlights.isError ? (
              <EmptyState>No se pudieron cargar las jugadas.</EmptyState>
            ) : (highlights.data?.pages.flatMap((p) => p.highlights) ?? []).length === 0 ? (
              <EmptyState>
                Aún sin jugadas de este equipo. Los resúmenes salen un rato después de cada partido.
              </EmptyState>
            ) : (
              <>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {(highlights.data?.pages.flatMap((p) => p.highlights) ?? []).map((highlight) => (
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
                <MoreButton
                  hasMore={highlights.hasNextPage}
                  loading={highlights.isFetchingNextPage}
                  onClick={() => void highlights.fetchNextPage()}
                />
              </>
            )}
          </>
        )}
        {tab === 'calendario' && (
          <Calendar
            isPending={games.isPending}
            isError={games.isError}
            games={games.data?.games ?? []}
            teams={teamsByAbbr}
            abbr={abbr}
            timeZone={timeZone}
            onRetry={() => void games.refetch()}
          />
        )}
      </div>
    </>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} role="status" className="grid gap-3">
      {[0, 1].map((slot) => (
        <div key={slot} className="h-[200px] rounded-card bg-surface" />
      ))}
    </div>
  );
}

function NewsTab({
  query,
  favorites,
  teams,
  timeZone,
  now,
  translation,
  onPlayer,
}: {
  query: ReturnType<typeof useNews>;
  favorites: readonly string[];
  teams: ReadonlyMap<string, TeamWithCrest>;
  timeZone: string;
  now: Date;
  translation: { available: boolean; blocked: boolean };
  onPlayer: (name: string) => void;
}) {
  const items = query.data?.pages.flatMap((page) => page.news) ?? [];
  if (query.isPending) return <Loading label="Cargando noticias" />;
  if (query.isError && items.length === 0) {
    return <EmptyState>No se pudieron cargar las noticias.</EmptyState>;
  }
  if (items.length === 0) return <EmptyState>Todavía no hay noticias de este equipo.</EmptyState>;
  return (
    <>
      <ul className="m-0 grid list-none gap-3 p-0">
        {items.map((item) => (
          <li key={item.id}>
            <NewsCard
              item={item}
              favorites={favorites}
              teams={teams}
              timeZone={timeZone}
              now={now}
              onPlayer={onPlayer}
              translation={translation}
            />
          </li>
        ))}
      </ul>
      <MoreButton
        hasMore={query.hasNextPage}
        loading={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </>
  );
}

/** Games still to play (soonest first) and results (latest first). */
function Calendar({
  isPending,
  isError,
  games,
  teams,
  abbr,
  timeZone,
  onRetry,
}: {
  isPending: boolean;
  isError: boolean;
  games: readonly Game[];
  teams: ReadonlyMap<string, TeamWithCrest>;
  abbr: string;
  timeZone: string;
  onRetry: () => void;
}) {
  if (isPending) return <Loading label="Cargando partidos" />;
  if (isError) {
    return (
      <EmptyState>
        No se pudo cargar el calendario.
        <br />
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 min-h-10 cursor-pointer rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text"
        >
          Reintentar
        </button>
      </EmptyState>
    );
  }
  const finished = (game: Game) =>
    game.status === 'final' || game.status === 'postponed' || game.status === 'canceled';
  const upcoming = games.filter((g) => !finished(g));
  const results = games.filter(finished).reverse();
  if (games.length === 0) return <EmptyState>Este equipo no tiene partidos guardados.</EmptyState>;

  const list = (items: readonly Game[]) => (
    <ul className="m-0 grid list-none gap-2 p-0">
      {items.map((game) => (
        <li key={game.id}>
          <MiniGame game={game} teams={teams} favorites={[abbr]} timeZone={timeZone} />
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {upcoming.length > 0 && (
        <>
          <h2 className="voice-name mb-2.5 text-xl">Próximos</h2>
          {list(upcoming)}
        </>
      )}
      {results.length > 0 && (
        <>
          <h2 className="voice-name mt-6 mb-2.5 text-xl">Resultados</h2>
          {list(results)}
        </>
      )}
    </>
  );
}
