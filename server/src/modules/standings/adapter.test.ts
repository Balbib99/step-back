import { conferenceStandingsSchema, isTeamAbbr, type ConferenceStandings } from '@step-back/shared';
import { describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import type { HttpClient } from '../../core/http.js';
import { EspnFormatError } from '../espn-common.js';
import {
  ESPN_STANDINGS_URL,
  fetchStandings,
  parseStandings,
  type ParsedConference,
} from './adapter.js';

const stamp = (table: ParsedConference): ConferenceStandings => ({
  ...table,
  updatedAt: '2026-10-07T18:00:00.000Z',
});

describe('parseStandings · a finished season (real: 2025-26)', () => {
  const tables = parseStandings(readEspnFixture('standings-2025-26.json'));
  const east = tables.find((t) => t.conference === 'east')!;
  const west = tables.find((t) => t.conference === 'west')!;

  it('returns the east and west conferences with 15 teams each', () => {
    expect(tables.map((t) => t.conference).sort()).toEqual(['east', 'west']);
    expect(east.entries).toHaveLength(15);
    expect(west.entries).toHaveLength(15);
  });

  it('knows which season and which games the table counts', () => {
    expect(east).toMatchObject({ season: 2026, seasonType: 'regular' });
  });

  it('puts the teams in rank order, although ESPN sends them in no order', () => {
    for (const table of tables) {
      expect(table.entries.map((e) => e.rank)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    }
    expect(east.entries.slice(0, 4).map((e) => e.abbr)).toEqual(['DET', 'BOS', 'NY', 'CLE']);
    expect(west.entries.slice(0, 6).map((e) => e.abbr)).toEqual([
      'OKC',
      'SA',
      'DEN',
      'LAL',
      'HOU',
      'MIN',
    ]);
  });

  it('follows the seed, not the number of wins: Portland is 7th with fewer wins than 8th Phoenix', () => {
    const seventh = west.entries[6]!;
    const eighth = west.entries[7]!;
    expect([seventh.abbr, eighth.abbr]).toEqual(['POR', 'PHX']);
    expect(seventh.wins).toBeLessThan(eighth.wins);
  });

  it('keeps wins plus losses equal to the games played, and a coherent percentage', () => {
    for (const entry of [...east.entries, ...west.entries]) {
      expect(entry.wins + entry.losses).toBeGreaterThan(0);
      expect(entry.winPct).toBeCloseTo(entry.wins / (entry.wins + entry.losses), 2);
    }
  });

  it('gives games behind as zero for the leader and growing after', () => {
    expect(east.entries[0]?.gamesBehind).toBe(0);
    expect(east.entries[14]?.gamesBehind).toBeGreaterThan(east.entries[1]!.gamesBehind);
  });

  it('maps a team completely (Minnesota, 6th seed in the west)', () => {
    const min = west.entries.find((e) => e.abbr === 'MIN');
    expect(min).toEqual({
      teamId: '16',
      abbr: 'MIN',
      name: 'Minnesota Timberwolves',
      rank: 6,
      wins: 49,
      losses: 33,
      winPct: 0.597561,
      gamesBehind: 15,
      streak: 'W2',
      home: '26-15',
      road: '23-18',
      last10: '5-5',
      conferenceRecord: '31-21',
      divisionRecord: '9-7',
      clincher: 'x',
      pointsFor: 118,
      pointsAgainst: 114.64634,
    });
  });

  it('turns ESPN\'s "-" into nothing', () => {
    expect(east.entries[0]?.gamesBehind).toBe(0);
    for (const entry of east.entries) expect(entry.streak).not.toBe('-');
  });

  it("keeps ESPN's clinch marks as they come", () => {
    const marks = new Set([...east.entries, ...west.entries].map((e) => e.clincher));
    expect(marks.has('z') || marks.has('y') || marks.has('x')).toBe(true);
  });

  it('maps every entry to a valid ConferenceStandings', () => {
    for (const table of tables)
      expect(() => conferenceStandingsSchema.parse(stamp(table))).not.toThrow();
  });

  it('uses abbreviations that all have a team palette', () => {
    const unknown = [...east.entries, ...west.entries].filter((e) => !isTeamAbbr(e.abbr));
    expect(unknown).toEqual([]);
  });
});

describe('parseStandings · preseason (real: the table ESPN serves before the season)', () => {
  const tables = parseStandings(readEspnFixture('standings-preseason.json'));

  it('is marked as preseason, because it is not the official standings', () => {
    for (const table of tables) {
      expect(table.seasonType).toBe('preseason');
      expect(table.season).toBe(2027);
    }
  });

  it('has the 15 teams of each conference with only a few games played', () => {
    for (const table of tables) {
      expect(table.entries).toHaveLength(15);
      for (const entry of table.entries) expect(entry.wins + entry.losses).toBeLessThanOrEqual(6);
    }
  });

  it('carries no clinch marks yet', () => {
    for (const table of tables)
      for (const entry of table.entries) expect(entry.clincher).toBeNull();
  });
});

describe('format changes fail loudly', () => {
  const fixture = () =>
    structuredClone(readEspnFixture('standings-2025-26.json')) as {
      children: Array<{
        abbreviation: string;
        standings: { seasonType: number; entries: Array<{ stats: Array<{ type: string }> }> };
      }>;
    };

  it('reports where the payload stopped matching', () => {
    expect(() => parseStandings({ message: 'rate limited' })).toThrow(EspnFormatError);
    expect(() => parseStandings({ message: 'rate limited' })).toThrow(/standings format changed/);
  });

  it('names the team and statistic that went missing', () => {
    const data = fixture();
    data.children[0]!.standings.entries[0]!.stats =
      data.children[0]!.standings.entries[0]!.stats.filter((s) => s.type !== 'playoffseed');
    expect(() => parseStandings(data)).toThrow(/no "playoffseed" statistic/);
  });

  it('rejects an unknown season type instead of guessing', () => {
    const data = fixture();
    data.children[0]!.standings.seasonType = 9;
    expect(() => parseStandings(data)).toThrow(/unknown season type 9/);
  });

  it('rejects an unknown conference', () => {
    const data = fixture();
    data.children[0]!.abbreviation = 'Central';
    expect(() => parseStandings(data)).toThrow(/unknown conference "Central"/);
  });

  it('rejects a table with a conference missing', () => {
    const data = fixture();
    data.children.pop();
    expect(() => parseStandings(data)).toThrow(/expected the east and west conferences/);
  });

  it('refuses an empty conference rather than wiping a good table with it', () => {
    const data = fixture();
    data.children[0]!.standings.entries = [];
    expect(() => parseStandings(data)).toThrow(/has no teams/);
  });
});

describe('fetchStandings', () => {
  it('asks ESPN for the standings and parses them', async () => {
    const getJson = vi.fn(async () => readEspnFixture('standings-preseason.json'));
    const http = { get: vi.fn(), getJson } as unknown as HttpClient;
    const tables = await fetchStandings(http);
    expect(getJson).toHaveBeenCalledWith(ESPN_STANDINGS_URL);
    expect(tables).toHaveLength(2);
  });
});
