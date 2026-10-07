import type { Game } from '@step-back/shared';
import type { HttpClient } from '../../core/http.js';
import type { Logger } from '../../core/logger.js';
import type { GamesRepo } from '../games/repo.js';
import { createTagger, type TaggerTeam } from '../news/tagger.js';
import { fetchYoutubeFeed } from './adapter.js';
import {
  classifyTitle,
  findGame,
  GAME_LENGTH_MS,
  MATCH_WINDOW_MS,
  teamsInTitle,
  type MatcherTeam,
} from './matcher.js';
import type { HighlightsRepo, NewVideo } from './repo.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Finished games are searched this far back: video + 36 h window + a margin. */
const GAMES_LOOKBACK_MS = 14 * 24 * HOUR;
/** A summary that is still unlinked after this long is not going to be linked. */
const RELINK_FOR_MS = 7 * 24 * HOUR;

export const NORMAL_EVERY_MS = 15 * MINUTE;
export const AFTER_GAME_EVERY_MS = 5 * MINUTE;

/**
 * How long to wait before reading the channel again: 15 minutes, or 5 in the hour after the end of
 * a favourite team's game (that is when its summary comes out).
 */
export function refreshDelay(now: number, games: GamesRepo, favorites: readonly string[]): number {
  const recent = games.games({
    fromUtc: new Date(now - GAME_LENGTH_MS - HOUR).toISOString(),
    toUtc: new Date(now).toISOString(),
  });
  const justEnded = recent.some(
    (game) =>
      game.status === 'final' &&
      (favorites.includes(game.home.abbr) || favorites.includes(game.away.abbr)),
  );
  return justEnded ? AFTER_GAME_EVERY_MS : NORMAL_EVERY_MS;
}

export interface HighlightsRefreshResult {
  seen: number;
  added: number;
  linked: number;
}

/** Reads the channel, stores the new videos with their game and labels, and links late ones. */
export async function refreshHighlights(deps: {
  http: HttpClient;
  repo: HighlightsRepo;
  games: GamesRepo;
  knownPlayers: readonly string[];
  logger: Logger;
  now: number;
}): Promise<HighlightsRefreshResult> {
  const { http, repo, games, knownPlayers, logger, now } = deps;

  const videos = await fetchYoutubeFeed(http);
  const teams = games.teams();
  const matcherTeams: MatcherTeam[] = teams;
  const taggerTeams: TaggerTeam[] = teams;
  const tagger = createTagger(taggerTeams, knownPlayers);
  const recentGames = games.games({ fromUtc: new Date(now - GAMES_LOOKBACK_MS).toISOString() });

  const entries: NewVideo[] = videos.map((video) => {
    const kind = classifyTitle(video.title);
    const tags = tagger.tag({ title: video.title, summary: null, teamIds: [], playerNames: [] });
    const teamSet = new Set(tags.teams);
    let gameId: string | null = null;

    if (kind === 'full_highlights') {
      // The NBA writes these titles in capitals and in many ways: letter case does not count here.
      const named = teamsInTitle(video.title, matcherTeams);
      for (const abbr of named) teamSet.add(abbr);
      gameId = findGame(named, video.publishedAt, recentGames)?.id ?? null;
    }
    return { video, kind, gameId, teams: [...teamSet], players: tags.players };
  });

  const added = repo.ingest(entries, now);
  const linked = relink(repo, games, matcherTeams, now);
  logger.info({ seen: videos.length, added, linked }, 'highlights refreshed');
  return { seen: videos.length, added, linked };
}

/**
 * A summary can come out before the game is stored as finished: try again for the ones still
 * without a game.
 */
function relink(
  repo: HighlightsRepo,
  games: GamesRepo,
  teams: readonly MatcherTeam[],
  now: number,
): number {
  const pending = repo.unlinked(now - RELINK_FOR_MS);
  if (pending.length === 0) return 0;
  const candidates: Game[] = games.games({
    fromUtc: new Date(now - RELINK_FOR_MS - MATCH_WINDOW_MS).toISOString(),
  });
  let linked = 0;
  for (const video of pending) {
    const game = findGame(teamsInTitle(video.title, teams), video.publishedAt, candidates);
    if (game) {
      repo.link(video.id, game.id);
      linked += 1;
    }
  }
  return linked;
}
