import type { Highlight, TeamWithCrest } from '@step-back/shared';
import { useState } from 'react';
import { timeAgo } from '../lib/news';
import { TeamBand } from './TeamBand';

/**
 * The player of a video. It starts as the thumbnail with a play button and becomes the YouTube
 * player (youtube-nocookie.com) only when pressed, so nothing is loaded from YouTube until the
 * viewer asks for it.
 */
export function VideoPlayer({ highlight }: { highlight: Highlight }) {
  const [playing, setPlaying] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  if (playing) {
    return (
      <div className="mt-3 aspect-video overflow-hidden rounded-[8px] bg-black">
        <iframe
          title={highlight.title}
          src={`${highlight.embedUrl}?autoplay=1&playsinline=1&rel=0`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full border-0"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Reproducir ${highlight.title}`}
      className="relative mt-3 block aspect-video w-full cursor-pointer overflow-hidden rounded-[8px] border-0 bg-surface-2 p-0"
    >
      {!thumbnailFailed && (
        <img
          src={highlight.thumbnailUrl}
          alt=""
          loading="lazy"
          onError={() => setThumbnailFailed(true)}
          className="size-full object-cover"
        />
      )}
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/25">
        <span className="grid size-14 place-items-center rounded-full bg-black/65 text-2xl text-white">
          ▶
        </span>
      </span>
    </button>
  );
}

/** A video as a post: team band, source line, title, player, and a link to YouTube. */
export function HighlightCard({
  highlight,
  favorites,
  teams,
  timeZone,
  now,
}: {
  highlight: Highlight;
  favorites: readonly string[];
  teams: ReadonlyMap<string, TeamWithCrest>;
  timeZone: string;
  now: Date;
}) {
  const summary = highlight.kind === 'full_highlights';
  return (
    <article aria-label={highlight.title} className="overflow-hidden rounded-card bg-surface">
      <TeamBand teams={highlight.teams} favorites={favorites} byAbbr={teams} />
      <div className="p-3.5">
        <p className="flex items-center gap-2 text-[12px] text-text-3">
          <span
            aria-hidden="true"
            className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-text-2"
          >
            N
          </span>
          <span className="min-w-0 truncate font-semibold text-text-2">NBA</span>
          <span>{summary ? 'Resumen del partido' : 'Jugada'}</span>
          <time dateTime={highlight.publishedAt} className="ml-auto shrink-0">
            {timeAgo(highlight.publishedAt, now, timeZone)}
          </time>
        </p>

        <h2 className="voice-name mt-2 text-[21px] [overflow-wrap:anywhere]">{highlight.title}</h2>

        <VideoPlayer highlight={highlight} />

        <div className="mt-3 flex justify-end">
          <a
            href={highlight.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text no-underline"
          >
            Ver en YouTube
          </a>
        </div>
      </div>
    </article>
  );
}
