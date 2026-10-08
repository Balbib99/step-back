import { GameCard } from '../components/GameCard';
import { MiniGame } from '../components/MiniGame';
import { NextGameRow } from '../components/NextGameRow';
import { EmptyState, PageHeader } from '../components/PageHeader';
import {
  favouritesPlaying,
  groupByDay,
  involves,
  nextGameOf,
  orderForToday,
} from '../lib/calendar';
import { addDays, dayLabel, localDay } from '../lib/dates';
import { DEFAULT_TIME_ZONE } from '../lib/format';
import { useConfig, useGamesRange, useTeams } from '../lib/queries';

/** How far ahead to look for the next game of a team that does not play today. */
const LOOK_AHEAD_DAYS = 14;

const SECTION_TITLE = 'voice-name mt-6 mb-2.5 text-xl';

function Skeleton() {
  return (
    <div
      aria-busy="true"
      role="status"
      aria-label="Cargando partidos"
      className="mt-6 grid gap-3.5"
    >
      {[0, 1].map((slot) => (
        <div key={slot} className="h-[200px] rounded-card bg-surface" />
      ))}
    </div>
  );
}

export function Today() {
  const config = useConfig();
  const teams = useTeams();

  const timeZone = config.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const favorites = config.data?.favoriteTeams ?? [];
  const now = new Date();
  const today = localDay(now, timeZone);

  const range = useGamesRange(today, addDays(today, LOOK_AHEAD_DAYS));

  const teamsByAbbr = new Map((teams.data?.teams ?? []).map((team) => [team.abbr, team]));
  const games = range.data?.games ?? [];
  const todayGames = orderForToday(groupByDay(games, timeZone).get(today) ?? []);
  const favouriteGames = todayGames.filter((game) => involves(game, favorites));
  const otherGames = todayGames.filter((game) => !involves(game, favorites));
  const notPlayingToday = favorites.filter(
    (abbr) => !favouritesPlaying(todayGames, favorites).includes(abbr),
  );

  const subtitle = dayLabel(today);

  if (config.isError) {
    return (
      <>
        <PageHeader title="Hoy" subtitle={subtitle} sources={['games']} />
        <EmptyState>
          No se pudo cargar tu configuración. Comprueba que el servidor está en marcha.
        </EmptyState>
      </>
    );
  }
  if (config.isPending || range.isPending) {
    return (
      <>
        <PageHeader title="Hoy" subtitle={subtitle} sources={['games']} />
        <Skeleton />
      </>
    );
  }
  if (range.isError) {
    return (
      <>
        <PageHeader title="Hoy" subtitle={subtitle} sources={['games']} />
        <EmptyState>
          No se pudieron cargar los partidos. Comprueba que el servidor está en marcha.
          <br />
          <button
            type="button"
            onClick={() => void range.refetch()}
            className="mt-3 min-h-10 cursor-pointer rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text"
          >
            Reintentar
          </button>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Hoy" subtitle={subtitle} sources={['games']} />

      {favouriteGames.length > 0 && (
        <>
          <h2 className={SECTION_TITLE}>Tus equipos</h2>
          {favouriteGames.map((game) => (
            <GameCard key={game.id} game={game} teams={teamsByAbbr} timeZone={timeZone} />
          ))}
        </>
      )}

      {todayGames.length === 0 && <EmptyState>Hoy no hay partidos de la NBA.</EmptyState>}

      {notPlayingToday.length > 0 && (
        <>
          <h2 className={SECTION_TITLE}>
            {favouriteGames.length > 0 ? 'Próximo partido' : 'Tus equipos no juegan hoy'}
          </h2>
          <div className="grid gap-2">
            {notPlayingToday.map((abbr) => (
              <NextGameRow
                key={abbr}
                abbr={abbr}
                game={nextGameOf(games, abbr, now.toISOString())}
                timeZone={timeZone}
              />
            ))}
          </div>
        </>
      )}

      {otherGames.length > 0 && (
        <>
          <h2 className={SECTION_TITLE}>
            Más partidos{' '}
            <span className="ml-1 text-sm font-medium text-text-3">{otherGames.length}</span>
          </h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {otherGames.map((game) => (
              <li key={game.id}>
                <MiniGame
                  game={game}
                  teams={teamsByAbbr}
                  favorites={favorites}
                  timeZone={timeZone}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
