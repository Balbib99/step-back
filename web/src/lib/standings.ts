import type { Conference, ConferenceStandings } from '@step-back/shared';

export type Zone = 'playoffs' | 'playin' | 'out';

/** Direct play-off berth for 1-6, play-in for 7-10, out for 11-15. */
export function zoneOf(rank: number): Zone {
  if (rank <= 6) return 'playoffs';
  if (rank <= 10) return 'playin';
  return 'out';
}

/** 2027 is the 2026-27 season. */
export function seasonLabel(season: number): string {
  return `${season - 1}-${String(season).slice(-2)}`;
}

export const CONFERENCE_PARAM: Record<Conference, string> = { east: 'este', west: 'oeste' };
export const CONFERENCE_NAME: Record<Conference, string> = { east: 'Este', west: 'Oeste' };

export function conferenceFromParam(value: string | null): Conference | undefined {
  return (Object.keys(CONFERENCE_PARAM) as Conference[]).find((c) => CONFERENCE_PARAM[c] === value);
}

/** The conference of the first favourite found, so the screen opens where the user's team is. */
export function defaultConference(
  tables: readonly ConferenceStandings[],
  favorites: readonly string[],
): Conference {
  for (const abbr of favorites) {
    const table = tables.find((t) => t.entries.some((e) => e.abbr === abbr));
    if (table) return table.conference;
  }
  return 'east';
}

/** "-" for a missing value, so a column never shows "null". */
export const orDash = (value: string | null): string => value ?? '–';
