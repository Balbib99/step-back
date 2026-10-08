import type { NewsEvent, PushEvent } from './detector.js';

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification goes. */
  url: string;
  /** A newer notification with the same tag replaces the older one. */
  tag: string;
}

function clock(startUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(startUtc));
}

/** The text of a notification, in Spanish, with the times in the display zone. */
export function messageFor(event: PushEvent, timeZone: string): PushPayload {
  const { game } = event;
  const { home, away } = game;
  const matchup = `${away.name} en ${home.name}`;
  const url = `/partido/${encodeURIComponent(game.id)}`;
  const tag = event.key;

  switch (event.kind) {
    case 'reminder':
      return {
        title: `${away.abbr} @ ${home.abbr} · en ${event.reminderMinutes} min`,
        body: `${matchup}. Empieza a las ${clock(game.startUtc, timeZone)}.`,
        url,
        tag,
      };
    case 'start':
      return { title: `¡Empieza! ${away.abbr} @ ${home.abbr}`, body: matchup, url, tag };
    case 'end': {
      const winner = [home, away].find((side) => side.winner === true);
      return {
        title: `Final: ${away.abbr} ${away.score ?? '-'} – ${home.score ?? '-'} ${home.abbr}`,
        body: winner ? `Gana ${winner.name}.` : matchup,
        url,
        tag,
      };
    }
  }
}

const MAX_TITLE = 110;

/** A featured news item: its title, where it comes from and which of your teams it is about. */
export function newsMessageFor(event: NewsEvent, sourceName: string): PushPayload {
  const { item, teams } = event;
  const title =
    item.title.length > MAX_TITLE ? `${item.title.slice(0, MAX_TITLE - 1)}…` : item.title;
  return {
    title,
    body: `${sourceName} · ${teams.join(', ')}`,
    // The app's news of that team: the article itself lives at its source.
    url: `/noticias?equipo=${encodeURIComponent(teams[0]!)}`,
    tag: event.key,
  };
}
