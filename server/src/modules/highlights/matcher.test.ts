import type { Game } from '@step-back/shared';
import { describe, expect, it } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { parseScoreboard, parseTeams } from '../games/adapter.js';
import {
  classifyTitle,
  findGame,
  GAME_LENGTH_MS,
  MATCH_WINDOW_MS,
  teamsInTitle,
} from './matcher.js';

const TEAMS = parseTeams(readEspnFixture('teams.json'));
const FINALS = parseScoreboard(readEspnFixture('scoreboard-final.json')); // BKN@CHA, NO@OKC, DEN@UTAH, LAL@GS
const HOUR = 3_600_000;

const endOf = (game: Game) => Date.parse(game.startUtc) + GAME_LENGTH_MS;
const game = (abbrs: [string, string], startUtc: string, status: Game['status'] = 'final') =>
  ({
    ...FINALS[0]!,
    id: `${abbrs[0]}-${abbrs[1]}-${startUtc}`,
    startUtc,
    status,
    away: { ...FINALS[0]!.away, abbr: abbrs[0] },
    home: { ...FINALS[0]!.home, abbr: abbrs[1] },
  }) as Game;

describe('classifyTitle', () => {
  it.each([
    ['Denver Nuggets vs. Utah Jazz: Game Highlights', 'full_highlights'], // ESPN, real
    ['NUGGETS at JAZZ | FULL GAME HIGHLIGHTS | October 6, 2026', 'full_highlights'],
    ['Lakers vs Warriors Full Game Highlights | October 6, 2026', 'full_highlights'],
    ["NBA's Top 5 Plays of the Night | October 6, 2026", 'clip'], // real
    ['Cooper Flagg is ready for year two!', 'clip'], // real
    ['Curry Converts TWO 4-Point Plays 🤯🔥', 'clip'], // real
    ['Game Highlights from the weekend', 'full_highlights'],
    ['Highlights of the year', 'clip'],
  ])('%s → %s', (title, kind) => {
    expect(classifyTitle(title)).toBe(kind);
  });
});

describe('teamsInTitle', () => {
  // Real titles (ESPN's clips of last night's games) and the formats the NBA channel uses for a
  // game summary: capitals, "at" and "vs", full names, nicknames and abbreviations of "76ers".
  const cases: [string, string[]][] = [
    // ESPN's real "Game Highlights" clips
    ['Los Angeles Lakers vs. Golden State Warriors: Game Highlights', ['LAL', 'GS']],
    ['Denver Nuggets vs. Utah Jazz: Game Highlights', ['DEN', 'UTAH']],
    ['New Orleans Pelicans vs. Oklahoma City Thunder: Game Highlights', ['NO', 'OKC']],
    ['Brooklyn Nets vs. Charlotte Hornets: Game Highlights', ['BKN', 'CHA']],
    // Formats used by the NBA channel
    ['NUGGETS at JAZZ | FULL GAME HIGHLIGHTS | October 6, 2026', ['DEN', 'UTAH']],
    ['LAKERS at WARRIORS | FULL GAME HIGHLIGHTS | October 6, 2026', ['LAL', 'GS']],
    ['TIMBERWOLVES at BUCKS | FULL GAME HIGHLIGHTS | October 5, 2026', ['MIN', 'MIL']],
    ['Minnesota Timberwolves vs Milwaukee Bucks | Full Game Highlights', ['MIN', 'MIL']],
    ['KNICKS at 76ERS | FULL GAME HIGHLIGHTS | October 5, 2026', ['NY', 'PHI']],
    ['New York Knicks vs Philadelphia 76ers Full Game Highlights', ['NY', 'PHI']],
    ['Sixers vs Knicks | Game Highlights', ['PHI', 'NY']],
    ['TRAIL BLAZERS at SUNS | FULL GAME HIGHLIGHTS', ['POR', 'PHX']],
    ['Portland vs Phoenix | Full Game Highlights', ['POR', 'PHX']],
    ['Wolves @ Lakers | Full Game Highlights', ['MIN', 'LAL']],
    ['Cavs vs Celtics Full Game Highlights', ['CLE', 'BOS']],
    ['Los Angeles Clippers vs Dallas Mavericks Full Game Highlights', ['LAC', 'DAL']],
    ['LA Clippers at Golden State Warriors | Full Game Highlights', ['LAC', 'GS']],
    ['Golden State vs Sacramento | Full Game Highlights', ['GS', 'SAC']],
    ['76ERS vs. HEAT | FULL GAME HIGHLIGHTS', ['PHI', 'MIA']],
    ['Oklahoma City Thunder vs San Antonio Spurs | Full Game Highlights', ['OKC', 'SA']],
    // Real titles from the NBA channel that name no team
    ["NBA's Top 5 Plays of the Night | October 6, 2026", []],
    ['Cooper Flagg is ready for year two!', []],
    ['Charlotte Mascot Drills a Half-Court Shot 🎯', ['CHA']], // a city alone is enough when it is unique
    ['Which was better the shot or the celebration? 👀 (via _huaaaaa/TT)', []],
  ];

  it.each(cases)('%s', (title, expected) => {
    expect(teamsInTitle(title, TEAMS)).toEqual(expected);
  });

  it('has at least twenty titles to be sure of it', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it('does not take Los Angeles for one team: two play there', () => {
    expect(teamsInTitle('Los Angeles vs Boston | Full Game Highlights', TEAMS)).toEqual(['BOS']);
  });

  it('does not find a team inside a longer word', () => {
    expect(teamsInTitle('Heater Magical Kingsley', TEAMS)).toEqual([]);
  });

  it('ignores accents and punctuation', () => {
    expect(teamsInTitle('Níkola… LAKERS!!', TEAMS)).toEqual(['LAL']);
  });
});

describe('findGame (real finals of the 6th of October)', () => {
  const [bknCha, noOkc, denUtah, lalGs] = FINALS as [Game, Game, Game, Game];

  it('links a summary to the game of its two teams, published after the game', () => {
    const published = endOf(denUtah) + 2 * HOUR;
    expect(findGame(['DEN', 'UTAH'], published, FINALS)?.id).toBe(denUtah.id);
    expect(findGame(['UTAH', 'DEN'], published, FINALS)?.id).toBe(denUtah.id); // order does not matter
  });

  it('links each of the four games of the night to its own video', () => {
    for (const g of FINALS) {
      expect(findGame([g.away.abbr, g.home.abbr], endOf(g) + HOUR, FINALS)?.id).toBe(g.id);
    }
  });

  it('accepts a video up to 36 hours either side of the end, and not beyond', () => {
    expect(findGame(['LAL', 'GS'], endOf(lalGs) + MATCH_WINDOW_MS, FINALS)?.id).toBe(lalGs.id);
    expect(findGame(['LAL', 'GS'], endOf(lalGs) - MATCH_WINDOW_MS, FINALS)?.id).toBe(lalGs.id);
    expect(findGame(['LAL', 'GS'], endOf(lalGs) + MATCH_WINDOW_MS + 1, FINALS)).toBeUndefined();
    expect(findGame(['LAL', 'GS'], endOf(lalGs) - MATCH_WINDOW_MS - 1, FINALS)).toBeUndefined();
  });

  it('does not link a video that names a pair that did not play', () => {
    expect(findGame(['DEN', 'GS'], endOf(denUtah), FINALS)).toBeUndefined();
  });

  it('needs exactly two teams: one, none or three are not a game', () => {
    expect(findGame(['DEN'], endOf(denUtah), FINALS)).toBeUndefined();
    expect(findGame([], endOf(denUtah), FINALS)).toBeUndefined();
    expect(findGame(['DEN', 'UTAH', 'GS'], endOf(denUtah), FINALS)).toBeUndefined();
  });

  it('does not link to a game that has not finished', () => {
    const live = { ...bknCha, status: 'live' as const };
    expect(findGame(['BKN', 'CHA'], endOf(bknCha), [live])).toBeUndefined();
    const scheduled = { ...bknCha, status: 'scheduled' as const };
    expect(findGame(['BKN', 'CHA'], endOf(bknCha), [scheduled])).toBeUndefined();
  });

  it('picks the closest game when the same two teams meet twice within the window', () => {
    const first = game(['MIN', 'LAL'], '2026-10-10T00:00:00Z');
    const second = game(['LAL', 'MIN'], '2026-10-11T00:00:00Z');
    const published = endOf(second) + HOUR;
    expect(findGame(['MIN', 'LAL'], published, [first, second])?.id).toBe(second.id);
    expect(findGame(['MIN', 'LAL'], endOf(first) + HOUR, [first, second])?.id).toBe(first.id);
  });

  it('gives nothing when there are no games', () => {
    expect(findGame(['DEN', 'UTAH'], Date.now(), [])).toBeUndefined();
    expect(noOkc.status).toBe('final');
  });
});
