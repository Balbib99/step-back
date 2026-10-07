import type { Conference, SeasonType, StandingEntry } from '@step-back/shared';
import type { HttpClient } from '../../core/http.js';
import { EspnFormatError, parseWith } from '../espn-common.js';
import { espnStandings, type EspnStandingEntry, type EspnStat } from './espn-schemas.js';

/** Standings live under /apis/v2, not under /apis/site/v2 like the scoreboard and teams. */
export const ESPN_STANDINGS_URL =
  'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';

/** A conference table as ESPN gave it, before the server stamps when it was downloaded. */
export interface ParsedConference {
  conference: Conference;
  season: number;
  seasonType: SeasonType;
  entries: StandingEntry[];
}

const CONFERENCES: Record<string, Conference> = { East: 'east', West: 'west' };

function mapSeasonType(code: number): SeasonType {
  switch (code) {
    case 1:
      return 'preseason';
    case 2:
      return 'regular';
    case 3:
    case 5: // play-in tournament
      return 'playoffs';
    default:
      throw new EspnFormatError('standings', `unknown season type ${code}`);
  }
}

function mapEntry(entry: EspnStandingEntry): StandingEntry {
  const { team } = entry;
  const stat = (type: string): EspnStat | undefined => entry.stats.find((s) => s.type === type);
  const required = (type: string): number => {
    const value = stat(type)?.value;
    if (value === undefined) {
      throw new EspnFormatError('standings', `${team.abbreviation} has no "${type}" statistic`);
    }
    return value;
  };
  const text = (type: string): string | null => {
    const s = stat(type);
    const value = s?.summary ?? s?.displayValue;
    // ESPN writes "-" for "nothing to show" (a leader's games behind, a team with no streak yet).
    return value === undefined || value === '' || value === '-' ? null : value;
  };
  const optionalNumber = (type: string): number | null => stat(type)?.value ?? null;

  return {
    teamId: team.id,
    abbr: team.abbreviation,
    name: team.displayName,
    rank: Math.round(required('playoffseed')),
    wins: Math.round(required('wins')),
    losses: Math.round(required('losses')),
    winPct: required('winpercent'),
    gamesBehind: stat('gamesbehind')?.value ?? 0,
    streak: text('streak'),
    home: text('home'),
    road: text('road'),
    last10: text('lasttengames'),
    conferenceRecord: text('vsconf'),
    divisionRecord: text('vsdiv'),
    clincher: text('clincher'),
    pointsFor: optionalNumber('avgpointsfor'),
    pointsAgainst: optionalNumber('avgpointsagainst'),
  };
}

export function parseStandings(data: unknown): ParsedConference[] {
  const { children } = parseWith(espnStandings, data, 'standings');
  const tables = children.map((child): ParsedConference => {
    const conference = CONFERENCES[child.abbreviation];
    if (!conference) {
      throw new EspnFormatError('standings', `unknown conference "${child.abbreviation}"`);
    }
    const entries = child.standings.entries
      .map(mapEntry)
      // ESPN lists the teams in no particular order; the seed is the position.
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    return {
      conference,
      season: child.standings.season,
      seasonType: mapSeasonType(child.standings.seasonType),
      entries,
    };
  });

  const found = tables.map((table) => table.conference).sort();
  if (found.join() !== 'east,west') {
    throw new EspnFormatError(
      'standings',
      `expected the east and west conferences, got ${found.join() || 'none'}`,
    );
  }
  for (const table of tables) {
    if (table.entries.length === 0) {
      throw new EspnFormatError('standings', `the ${table.conference} conference has no teams`);
    }
  }
  return tables;
}

export async function fetchStandings(http: HttpClient): Promise<ParsedConference[]> {
  return parseStandings(await http.getJson(ESPN_STANDINGS_URL));
}
