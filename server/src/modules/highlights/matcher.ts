import type { Game, HighlightKind } from '@step-back/shared';
import { ALIASES } from '../news/tagger.js';

export interface MatcherTeam {
  abbr: string;
  name: string;
  shortName: string;
  location: string;
}

const HOUR = 3_600_000;
/** Titles can be published well before or after the game's end: spec of highlights, ±36 h. */
export const MATCH_WINDOW_MS = 36 * HOUR;
/** A game lasts about two and a half hours; ESPN gives the start, not the end. */
export const GAME_LENGTH_MS = 2.5 * HOUR;

/** Cities with two teams. ESPN calls the Lakers' city "Los Angeles" and the Clippers' "LA". */
const SHARED_CITIES = new Set(['los angeles', 'la']);

/** Lower case, no accents, no punctuation, single spaces: "76ers" and "76ERS" become the same. */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A summary of a whole game, as the NBA titles them ("... Full Game Highlights"). */
export function classifyTitle(title: string): HighlightKind {
  return /\b(full )?game highlights\b/i.test(title) ? 'full_highlights' : 'clip';
}

/**
 * The teams a title names, in the order it names them. The NBA writes them in capitals and in
 * many ways ("DENVER NUGGETS vs UTAH JAZZ", "NUGGETS at JAZZ", "Sixers"), so letter case does
 * not count. A city alone ("Denver") counts only when just one team plays there.
 */
export function teamsInTitle(title: string, teams: readonly MatcherTeam[]): string[] {
  const text = ` ${normalize(title)} `;
  const cityCount = new Map<string, number>();
  for (const team of teams) {
    const city = normalize(team.location);
    cityCount.set(city, (cityCount.get(city) ?? 0) + (SHARED_CITIES.has(city) ? 2 : 1));
  }

  const found: { abbr: string; at: number }[] = [];
  for (const team of teams) {
    const names = [
      team.name,
      team.shortName,
      ...(ALIASES[team.abbr] ?? []),
      ...(cityCount.get(normalize(team.location)) === 1 ? [team.location] : []),
    ]
      .map(normalize)
      .filter(Boolean);
    let first = -1;
    for (const name of names) {
      const at = text.search(new RegExp(` ${escape(name)} `));
      if (at !== -1 && (first === -1 || at < first)) first = at;
    }
    if (first !== -1) found.push({ abbr: team.abbr, at: first });
  }
  return found.sort((a, b) => a.at - b.at).map((team) => team.abbr);
}

/**
 * The finished game between the two named teams whose end is closest to the moment the video
 * came out, within 36 hours. Undefined when the title does not name exactly two teams or no such
 * game is stored.
 */
export function findGame(
  named: readonly string[],
  publishedAt: number,
  games: readonly Game[],
): Game | undefined {
  if (named.length !== 2) return undefined;
  let best: { game: Game; distance: number } | undefined;
  for (const game of games) {
    if (game.status !== 'final') continue;
    const sides = [game.home.abbr, game.away.abbr];
    if (!named.every((abbr) => sides.includes(abbr))) continue;
    const distance = Math.abs(publishedAt - (Date.parse(game.startUtc) + GAME_LENGTH_MS));
    if (distance <= MATCH_WINDOW_MS && (!best || distance < best.distance)) {
      best = { game, distance };
    }
  }
  return best?.game;
}
