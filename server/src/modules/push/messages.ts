import type { PushEvent } from './detector.js';

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
