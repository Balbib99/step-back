import type { FeedItem } from './feed-item.js';

export interface TaggerTeam {
  /** ESPN's id, as ESPN's own news labels teams. */
  id: string;
  abbr: string;
  shortName: string;
}

/** Names fans and headlines use besides the team's own. */
export const ALIASES: Record<string, string[]> = {
  PHI: ['Sixers'],
  MIN: ['Wolves'],
  POR: ['Blazers'],
  CLE: ['Cavs'],
  DAL: ['Mavs'],
  NO: ['Pels'],
  GS: ['Dubs'],
};

/** "Magic Johnson" is not the Orlando team. */
export const NOT_FOLLOWED_BY: Record<string, string> = { ORL: ' Johnson' };

export interface Tags {
  teams: string[];
  players: string[];
}

export interface Tagger {
  tag(item: Pick<FeedItem, 'title' | 'summary' | 'teamIds' | 'playerNames'>): Tags;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Word boundaries that also work next to accented letters and apostrophes.
const word = (alternatives: string[], notFollowedBy = '') =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${alternatives.map(escape).join('|')})(?![\\p{L}\\p{N}])${
      notFollowedBy ? `(?!${escape(notFollowedBy)})` : ''
    }`,
    'u',
  );

/**
 * Finds the teams and players a news item is about. When the source labels them itself (ESPN),
 * its labels are used as they are. Otherwise the title and summary are searched for team names
 * (capitalised, so "magic" or "heat" as plain words do not count) and for the full names of
 * players ESPN has labelled before.
 */
export function createTagger(
  teams: readonly TaggerTeam[],
  knownPlayers: readonly string[],
): Tagger {
  const byId = new Map(teams.map((team) => [team.id, team.abbr]));
  const teamPatterns = teams.map((team) => ({
    abbr: team.abbr,
    pattern: word([team.shortName, ...(ALIASES[team.abbr] ?? [])], NOT_FOLLOWED_BY[team.abbr]),
  }));
  // Longest first, so "Karl-Anthony Towns Jr." is not cut short by a shorter name.
  const players = [...new Set(knownPlayers)].sort((a, b) => b.length - a.length);
  const playerPattern = players.length > 0 ? word(players) : undefined;
  const playerGlobal = playerPattern && new RegExp(playerPattern.source, 'gu');

  return {
    tag(item) {
      const text = `${item.title}. ${item.summary ?? ''}`;

      const labelled = item.teamIds.map((id) => byId.get(id)).filter((abbr) => abbr !== undefined);
      const teamsFound =
        item.teamIds.length > 0
          ? labelled
          : teamPatterns.filter(({ pattern }) => pattern.test(text)).map(({ abbr }) => abbr);

      const playersFound =
        item.playerNames.length > 0
          ? item.playerNames
          : playerGlobal
            ? [...text.matchAll(playerGlobal)].map((match) => match[0])
            : [];

      return { teams: [...new Set(teamsFound)], players: [...new Set(playersFound)] };
    },
  };
}
