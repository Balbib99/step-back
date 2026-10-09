import type { NewsItem } from '@step-back/shared';
import { formatDayLabel } from './format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "hace 5 min", "hace 3 h", "ayer" or "5 oct": how long ago a piece of news came out. */
export function timeAgo(iso: string, now: Date, timeZone: string): string {
  const age = now.getTime() - new Date(iso).getTime();
  if (age < MINUTE) return 'ahora';
  if (age < HOUR) return `hace ${Math.floor(age / MINUTE)} min`;
  if (age < 24 * HOUR) return `hace ${Math.floor(age / HOUR)} h`;
  if (age < 48 * HOUR) return 'ayer';
  return formatDayLabel(new Date(iso), timeZone).replace(/^\S+ /, '');
}

/** What kind of post it is, in the words of docs/design.md. */
export function kindLabel(item: Pick<NewsItem, 'mediaKind'>): string | undefined {
  if (item.mediaKind === 'video') return 'Vídeo';
  if (item.mediaKind === 'image') return 'Imagen';
  return undefined;
}

/**
 * The team a post is about, for its coloured band: a favourite if the post is about one, otherwise
 * the first team it names. Undefined for a post about the league or a player with no team.
 */
export function bandTeam(
  teams: readonly string[],
  favorites: readonly string[],
): { main: string; others: string[] } | undefined {
  const main = teams.find((abbr) => favorites.includes(abbr)) ?? teams[0];
  return main ? { main, others: teams.filter((abbr) => abbr !== main) } : undefined;
}

export interface NewsFilters {
  /** Abbreviations, or none for every team. */
  teams: readonly string[];
  player: string | undefined;
  lang: 'es' | undefined;
  video: boolean;
  /** Only the YouTube Shorts (their own section). Without it, the news leave them out. */
  shorts?: boolean;
}

/** The /api/news query for a set of filters (without the page cursor). */
export function newsQuery(filters: NewsFilters, before?: string): string {
  const params = new URLSearchParams({ limit: '20' });
  if (filters.teams.length > 0) params.set('team', filters.teams.join(','));
  if (filters.player) params.set('player', filters.player);
  if (filters.lang) params.set('lang', filters.lang);
  if (filters.video) params.set('media', 'video');
  if (filters.shorts) params.set('shorts', 'only');
  if (before) params.set('before', before);
  return `?${params.toString()}`;
}
