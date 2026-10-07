import type { HttpClient } from '../../core/http.js';
import type { Logger } from '../../core/logger.js';
import { fetchEspnNews } from './espn-adapter.js';
import type { FeedItem } from './feed-item.js';
import type { NewsRepo } from './repo.js';
import { fetchFeed } from './rss.js';
import type { NewsSource } from './sources.js';
import { createTagger, type TaggerTeam } from './tagger.js';

export interface RefreshResult {
  /** Items the source offered. */
  seen: number;
  /** Items that were new. */
  added: number;
  /** The source said nothing had changed since the last time. */
  notModified: boolean;
}

/** Downloads one source, labels what is new and stores it. A failure throws and touches nothing. */
export async function refreshSource(deps: {
  source: NewsSource;
  http: HttpClient;
  repo: NewsRepo;
  teams: readonly TaggerTeam[];
  logger: Logger;
  now: number;
}): Promise<RefreshResult> {
  const { source, http, repo, teams, logger, now } = deps;

  let items: FeedItem[];
  let validators: { etag?: string | undefined; lastModified?: string | undefined } | undefined;
  if (source.type === 'espn') {
    items = await fetchEspnNews(http);
  } else {
    const result = await fetchFeed(http, source.url, {
      validators: repo.sourceState(source.id),
      ...(source.imageFromContent !== undefined && { imageFromContent: source.imageFromContent }),
    });
    if (result.kind === 'not-modified') return { seen: 0, added: 0, notModified: true };
    items = result.items;
    validators = result.validators;
  }

  const skip = (source.skipTitles ?? []).map((pattern) => new RegExp(pattern));
  const wanted = items.filter((item) => !skip.some((pattern) => pattern.test(item.title)));

  // Built per run: ESPN's labels teach the tagger new players between one run and the next.
  const tagger = createTagger(teams, repo.knownPlayers());
  const added = repo.ingest(
    source.id,
    source.lang,
    wanted.map((item) => ({ item, tags: tagger.tag(item) })),
    now,
  );
  if (validators) repo.saveSourceState(source.id, validators);

  logger.info({ source: source.id, seen: items.length, added }, 'news source refreshed');
  return { seen: items.length, added, notModified: false };
}
