import type { Game as GameType } from '@step-back/shared';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink';
import { Boxscore } from '../components/Boxscore';
import { GameCard } from '../components/GameCard';
import { HighlightCard } from '../components/HighlightCard';
import { NewsCard } from '../components/NewsCard';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { ApiError } from '../lib/api';
import { dayLabel, localDay } from '../lib/dates';
import { DEFAULT_TIME_ZONE, formatClock } from '../lib/format';
import { phaseLabel } from '../lib/game-text';
import { pushPermission } from '../lib/push';
import {
  useConfig,
  useFollowGame,
  useGameHighlights,
  useNews,
  usePushFollows,
  usePushSettings,
  useTeams,
} from '../lib/queries';
import { useTranslationAvailability } from '../lib/translation';

const SECTION_TITLE = 'voice-name mt-7 mb-2.5 text-xl';
const RELATED_NEWS = 3;

/** Q1 to Q4, then PR1, PR2... for the overtimes. */
const periodName = (index: number) => (index < 4 ? `Q${index + 1}` : `PR${index - 3}`);

/** Points per period, one row per team. Only once the game has started. */
function LineScore({ game }: { game: GameType }) {
  const periods = Math.max(game.away.linescores.length, game.home.linescores.length);
  if (periods === 0) return null;
  const rows = [game.away, game.home];
  return (
    <div className="overflow-x-auto rounded-card bg-surface">
      <table className="w-full border-collapse text-center text-sm tabular-nums">
        <caption className="sr-only">Puntos por cuarto</caption>
        <thead>
          <tr className="text-[12px] text-text-3">
            <th scope="col" className="px-3.5 py-2 text-left font-medium">
              Equipo
            </th>
            {Array.from({ length: periods }, (_, index) => (
              <th key={index} scope="col" className="px-2 py-2 font-medium">
                {periodName(index)}
              </th>
            ))}
            <th scope="col" className="px-3.5 py-2 text-right font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((side) => (
            <tr key={side.abbr} className="border-t border-line">
              <th scope="row" className="voice-name px-3.5 py-2.5 text-left text-base">
                {side.abbr}
              </th>
              {Array.from({ length: periods }, (_, index) => (
                <td key={index} className="px-2 py-2.5 text-text-2">
                  {side.linescores[index] ?? '–'}
                </td>
              ))}
              <td className="voice-name px-3.5 py-2.5 text-right text-base">{side.score ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The live score as one notification that updates in place. A game of a team that has it on gets
 * it by itself; any other one is followed with a button, for as long as the game lasts.
 */
function FollowScore({ game }: { game: GameType }) {
  const config = useConfig();
  const pushOn = config.data?.features.push === true;
  const settings = usePushSettings(pushOn);
  const follows = usePushFollows(pushOn);
  const follow = useFollowGame();
  const open = game.status === 'scheduled' || game.status === 'live';
  if (!pushOn || !open) return null;

  const automatic = (settings.data?.teams ?? []).some(
    (t) => t.live && (t.team === game.home.abbr || t.team === game.away.abbr),
  );
  const following = (follows.data?.games ?? []).includes(game.id);
  const permission = pushPermission();

  return (
    <section aria-label="Marcador en el móvil" className="mt-3 rounded-card bg-surface p-4">
      {automatic ? (
        <p className="text-sm text-text-2">
          El marcador en directo te llegará solo al móvil, en una notificación que se va
          actualizando, porque es un partido de uno de tus equipos.{' '}
          <Link to="/ajustes" className="text-text underline">
            Cambiarlo en Ajustes
          </Link>
        </p>
      ) : (
        <div className="grid gap-2.5">
          <button
            type="button"
            aria-pressed={following}
            onClick={() => follow.mutate({ gameId: game.id, follow: !following })}
            className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-full border border-line bg-transparent px-4 text-sm font-semibold text-text"
          >
            {following ? 'Dejar de seguir el marcador' : 'Seguir el marcador en el móvil'}
          </button>
          <p className="text-[13px] text-text-2">
            {following
              ? 'Mientras dure el partido, el marcador llegará en una notificación que se va actualizando.'
              : 'Recibirás el marcador en una única notificación que se actualiza con cada cambio, sin sonido.'}
          </p>
          {permission !== 'granted' && (
            <p className="text-[13px] text-text-2">
              Para recibirlo, activa antes las notificaciones de este dispositivo en{' '}
              <Link to="/ajustes" className="text-text underline">
                Ajustes
              </Link>
              .
            </p>
          )}
        </div>
      )}
      {follow.isError && (
        <p role="alert" className="mt-2 text-[13px] text-text-2">
          No se pudo guardar el cambio. Inténtalo de nuevo.
        </p>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando partido" role="status" className="mt-4 grid gap-3.5">
      <div className="h-[200px] rounded-card bg-surface" />
      <div className="h-[100px] rounded-card bg-surface" />
    </div>
  );
}

export function Game() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const config = useConfig();
  const teams = useTeams();
  const game = useGameHighlights(id);
  const translation = useTranslationAvailability();

  const timeZone = config.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const favorites = config.data?.favoriteTeams ?? [];
  const teamsByAbbr = new Map((teams.data?.teams ?? []).map((t) => [t.abbr, t]));

  const data = game.data;
  const news = useNews(
    {
      teams: data ? [data.game.away.abbr, data.game.home.abbr] : [],
      player: undefined,
      lang: undefined,
      video: false,
    },
    data !== undefined,
  );

  if (game.isPending || config.isPending) {
    return (
      <>
        <BackLink />
        <PageHeader title="Partido" />
        <Skeleton />
      </>
    );
  }
  if (game.isError || !data) {
    const missing = game.error instanceof ApiError && game.error.status === 404;
    return (
      <>
        <BackLink />
        <PageHeader title="Partido" />
        <EmptyState>
          {missing
            ? 'Ese partido no existe. Puede que se haya cancelado o que la dirección esté mal.'
            : 'No se pudo cargar el partido. Comprueba que el servidor está en marcha.'}
          {!missing && (
            <>
              <br />
              <button
                type="button"
                onClick={() => void game.refetch()}
                className="mt-3 min-h-10 cursor-pointer rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text"
              >
                Reintentar
              </button>
            </>
          )}
        </EmptyState>
      </>
    );
  }

  const { game: match, highlights } = data;
  const when = `${dayLabel(localDay(match.startUtc, timeZone))} · ${formatClock(match.startUtc, timeZone)}`;
  const related = (news.data?.pages[0]?.news ?? []).slice(0, RELATED_NEWS);
  const now = new Date();
  const finished = match.status === 'final';

  return (
    <>
      <BackLink />
      <PageHeader
        title="Partido"
        subtitle={`${phaseLabel(match.seasonType, true)} · ${when}`}
        sources={['games']}
      />

      <div className="mt-4">
        <GameCard game={match} teams={teamsByAbbr} timeZone={timeZone} linked={false} />
      </div>
      <FollowScore game={match} />
      <LineScore game={match} />
      <Boxscore game={match} favorites={favorites} />

      <section aria-labelledby="game-videos">
        <h2 id="game-videos" className={SECTION_TITLE}>
          Jugadas del partido
        </h2>
        {highlights.length > 0 ? (
          <ul className="m-0 grid list-none gap-3 p-0">
            {highlights.map((highlight) => (
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
        ) : (
          <EmptyState>
            {finished
              ? 'Aún sin jugadas de este partido. El resumen del canal de la NBA sale un rato después del final.'
              : 'Las jugadas aparecerán cuando termine el partido.'}
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="game-news">
        <h2 id="game-news" className={SECTION_TITLE}>
          Noticias relacionadas
        </h2>
        {related.length > 0 ? (
          <ul className="m-0 grid list-none gap-3 p-0">
            {related.map((item) => (
              <li key={item.id}>
                <NewsCard
                  item={item}
                  favorites={favorites}
                  teams={teamsByAbbr}
                  timeZone={timeZone}
                  now={now}
                  onPlayer={(name) =>
                    navigate(`/noticias?equipo=todos&jugador=${encodeURIComponent(name)}`)
                  }
                  translation={translation}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>
            {news.isPending ? 'Buscando noticias…' : 'Todavía no hay noticias de estos equipos.'}
          </EmptyState>
        )}
      </section>
      <p className="mt-3 flex flex-wrap gap-2">
        {[match.away, match.home].map((side) => (
          <Link
            key={side.abbr}
            to={`/equipo/${side.abbr}`}
            className="inline-flex min-h-10 items-center rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text no-underline"
          >
            Ver {teamsByAbbr.get(side.abbr)?.shortName ?? side.name}
          </Link>
        ))}
      </p>
    </>
  );
}
