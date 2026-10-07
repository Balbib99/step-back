import type { NewsItem, TeamWithCrest } from '@step-back/shared';
import { useState } from 'react';
import { bandTeam, kindLabel, timeAgo } from '../lib/news';
import { teamStyle } from '../lib/team-style';
import { TeamCrest } from './TeamCrest';

const MAX_PLAYERS_SHOWN = 3;

/** The coloured band of a post: the team it is about, or a plain one for the league. */
function TeamBand({
  teams,
  favorites,
  byAbbr,
}: {
  teams: readonly string[];
  favorites: readonly string[];
  byAbbr: ReadonlyMap<string, TeamWithCrest>;
}) {
  const band = bandTeam(teams, favorites);
  if (!band) {
    return (
      <div className="flex min-h-9 items-center bg-surface-2 px-3 text-[13px] font-semibold text-text-2">
        NBA
      </div>
    );
  }
  const team = byAbbr.get(band.main);
  return (
    <div
      data-team={band.main}
      style={teamStyle(band.main)}
      className="team-field flex min-h-9 items-center gap-2 px-3 py-1"
    >
      <TeamCrest abbr={band.main} src={team?.crestUrl} size={24} />
      <span className="voice-number team-numeral text-lg">{band.main}</span>
      <span className="voice-name min-w-0 flex-1 truncate text-[15px]">
        {team?.shortName ?? ''}
      </span>
      {band.others.length > 0 && (
        <span className="text-[12px] font-semibold opacity-80">
          {band.others.map((abbr) => (abbr === band.main ? '' : abbr)).join(' · ')}
        </span>
      )}
    </div>
  );
}

function Media({ item }: { item: NewsItem }) {
  const [failed, setFailed] = useState(false);
  if (item.mediaKind === 'none' || !item.imageUrl || failed) return null;
  const video = item.mediaKind === 'video';
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${video ? 'Ver vídeo' : 'Ver imagen'} en ${item.sourceName}`}
      className="relative mt-3 block aspect-video overflow-hidden rounded-[8px] bg-surface-2"
    >
      <img
        src={item.imageUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
      {video && (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/25">
          <span className="grid size-14 place-items-center rounded-full bg-black/65 text-2xl text-white">
            ▶
          </span>
        </span>
      )}
      {video && (
        <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2.5 py-0.5 text-[12px] font-semibold text-white">
          Vídeo
        </span>
      )}
    </a>
  );
}

/**
 * A news item as a post (docs/design.md): team band, source line, headline, summary, the
 * picture or video as protagonist, and a link to the original. Without media it stays text only.
 */
export function NewsCard({
  item,
  favorites,
  teams,
  timeZone,
  now,
  onPlayer,
}: {
  item: NewsItem;
  favorites: readonly string[];
  teams: ReadonlyMap<string, TeamWithCrest>;
  timeZone: string;
  now: Date;
  onPlayer: (name: string) => void;
}) {
  const kind = kindLabel(item);
  return (
    <article aria-label={item.title} className="overflow-hidden rounded-card bg-surface">
      <TeamBand teams={item.teams} favorites={favorites} byAbbr={teams} />
      <div className="p-3.5">
        <p className="flex items-center gap-2 text-[12px] text-text-3">
          <span
            aria-hidden="true"
            className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-text-2"
          >
            {item.sourceName.replace(/^r\//, '').charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 truncate font-semibold text-text-2">{item.sourceName}</span>
          {kind && <span>{kind}</span>}
          <span>{item.lang === 'es' ? 'ES' : 'EN'}</span>
          <time dateTime={item.publishedAt} className="ml-auto shrink-0">
            {timeAgo(item.publishedAt, now, timeZone)}
          </time>
        </p>

        <h2 className="voice-name mt-2 text-[21px] [overflow-wrap:anywhere]">{item.title}</h2>
        {item.summary && (
          <p className="mt-1.5 line-clamp-2 text-[14px] text-text-2">{item.summary}</p>
        )}

        <Media item={item} />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.players.slice(0, MAX_PLAYERS_SHOWN).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onPlayer(name)}
              aria-label={`Ver noticias de ${name}`}
              className="min-h-8 cursor-pointer rounded-full border border-line bg-transparent px-3 text-[12px] font-semibold text-text-2"
            >
              {name}
            </button>
          ))}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex min-h-10 items-center rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text no-underline"
          >
            Abrir fuente
          </a>
        </div>
      </div>
    </article>
  );
}
