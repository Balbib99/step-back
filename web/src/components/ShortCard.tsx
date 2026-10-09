import type { NewsItem } from '@step-back/shared';
import { useState } from 'react';
import { timeAgo } from '../lib/news';

/**
 * A YouTube Short: a vertical thumbnail with its title over it. Pressing it plays the video in
 * the official player (youtube-nocookie.com), in the same place, taking the width of the grid;
 * nothing is loaded from YouTube until the viewer asks for it.
 */
export function ShortCard({
  item,
  timeZone,
  now,
  playing,
  onPlay,
  onClose,
}: {
  item: NewsItem;
  timeZone: string;
  now: Date;
  playing: boolean;
  onPlay: () => void;
  onClose: () => void;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const when = timeAgo(item.publishedAt, now, timeZone);

  if (playing && item.embedUrl) {
    return (
      <article aria-label={item.title} className="overflow-hidden rounded-card bg-surface p-3">
        <div className="mx-auto aspect-[9/16] h-[min(72dvh,640px)] max-w-full overflow-hidden rounded-[8px] bg-black">
          <iframe
            title={item.title}
            src={`${item.embedUrl}?autoplay=1&playsinline=1&rel=0`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="size-full border-0"
          />
        </div>
        <p className="voice-name mt-2.5 text-[15px]">{item.title}</p>
        <p className="mt-1 text-[12px] text-text-3">
          {item.sourceName} · {when}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 cursor-pointer rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-text"
          >
            Cerrar
          </button>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center rounded-full border border-line px-3.5 text-[13px] font-semibold text-text-2 no-underline"
          >
            Abrir en YouTube
          </a>
        </div>
      </article>
    );
  }

  const content = (
    <>
      {item.imageUrl && !thumbnailFailed && (
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setThumbnailFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/10"
      />
      <span className="absolute top-2 left-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">
        {item.sourceName}
      </span>
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-lg text-white"
      >
        ▶
      </span>
      <span className="absolute inset-x-2 bottom-2 text-left">
        <span className="voice-name line-clamp-3 block text-[14px] text-white">{item.title}</span>
        <span className="mt-1 block text-[11px] text-white/70">{when}</span>
      </span>
    </>
  );
  const box =
    'relative block aspect-[9/16] w-full overflow-hidden rounded-card bg-surface-2 p-0 text-inherit';

  // A Short that cannot be played here (no player address) still opens on YouTube.
  return item.embedUrl ? (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Reproducir ${item.title}`}
      className={`${box} cursor-pointer border-0`}
    >
      {content}
    </button>
  ) : (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Ver en ${item.sourceName}: ${item.title}`}
      className={`${box} no-underline`}
    >
      {content}
    </a>
  );
}
