// The real server (every module, the built web app) with the internet replaced by recorded
// answers, for the end-to-end tests. Run by Playwright (see playwright.config.ts):
//
//   npx tsx web/e2e/server/e2e-server.ts
//
// Nothing here touches ESPN, YouTube or DeepL, so the tests give the same result on any day. The
// games are the one thing made up: they are placed around "now", because the app shows what is on
// today and no recording of a past day would be "today" for long.
import { readFileSync } from 'node:fs';
import type { Game } from '@step-back/shared';
import { buildApp } from '../../../server/src/core/app.js';
import { loadConfig } from '../../../server/src/core/config.js';
import { localDay } from '../../../server/src/modules/games/dates.js';
import { gamesModule } from '../../../server/src/modules/games/index.js';
import { createGamesRepo } from '../../../server/src/modules/games/repo.js';
import { highlightsModule } from '../../../server/src/modules/highlights/index.js';
import { newsModule } from '../../../server/src/modules/news/index.js';
import { standingsModule } from '../../../server/src/modules/standings/index.js';
import { translationModule } from '../../../server/src/modules/translation/index.js';

const PORT = Number(process.env.E2E_PORT ?? 3200);
const FIXTURES = new URL('../../../server/test/fixtures/', import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), 'utf8');

// A real 1x1 PNG: crests and news pictures all come back as this.
const PIXEL = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const text = (body: string, type: string) =>
  new Response(body, { headers: { 'content-type': type } });

/** What the outside world answers. Anything not listed here is a mistake and fails loudly. */
const upstream = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const { host, pathname } = url;
  const picture = () => new Response(PIXEL, { headers: { 'content-type': 'image/png' } });
  if (/\.(png|jpe?g|gif|webp)$/i.test(pathname)) return picture();

  if (host === 'site.api.espn.com') {
    if (pathname.endsWith('/teams')) return text(fixture('espn/teams.json'), 'application/json');
    // The player numbers of the made-up final (the recorded box score of GS at POR).
    if (pathname.endsWith('/summary')) {
      return text(fixture('espn/summary-final.boxscore.json'), 'application/json');
    }
    if (pathname.endsWith('/schedule') || pathname.endsWith('/scoreboard')) {
      return json({ events: [] });
    }
    if (pathname.endsWith('/news')) return text(fixture('news/espn-news.json'), 'application/json');
  }
  if (host === 'cdn.espn.com' || pathname.includes('standings')) {
    return text(fixture('espn/standings-2025-26.json'), 'application/json');
  }
  if (host === 'sports.yahoo.com') return text(fixture('news/yahoo.rss.xml'), 'application/xml');
  if (host === 'www.cbssports.com') return text(fixture('news/cbs.rss.xml'), 'application/xml');
  if (host === 'www.reddit.com') return text(fixture('news/reddit.atom.xml'), 'application/xml');
  if (host === 'www.gigantes.com') {
    return text(fixture('news/gigantes.rss.xml'), 'application/xml');
  }
  if (host === 'www.youtube.com') {
    return text(fixture('highlights/nba-channel.atom.xml'), 'application/xml');
  }
  if (host === 'api-free.deepl.com') {
    if (pathname.endsWith('/usage'))
      return json({ character_count: 0, character_limit: 1_000_000 });
    const { text: texts } = JSON.parse(String(init?.body)) as { text: string[] };
    return json({ translations: texts.map((t) => ({ text: `ES: ${t}` })) });
  }
  // Everything else a feed can point at is a picture: crests, news images, thumbnails.
  if (init?.method === undefined || init.method === 'GET') {
    return picture();
  }
  throw new Error(`the e2e server has no answer for ${url.href}`);
}) as typeof fetch;

const config = loadConfig({
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(PORT),
  DB_PATH: ':memory:',
  CRESTS_DIR: process.env.E2E_DATA_DIR
    ? `${process.env.E2E_DATA_DIR}/crests`
    : './.e2e-data/crests',
  NEWS_IMAGES_DIR: process.env.E2E_DATA_DIR
    ? `${process.env.E2E_DATA_DIR}/news-images`
    : './.e2e-data/news-images',
  WEB_DIR: new URL('../../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  DEEPL_API_KEY: 'e2e-key:fx',
});

const { server, scheduler, db } = await buildApp({
  config,
  modules: [gamesModule, standingsModule, newsModule, highlightsModule, translationModule],
  fetch: upstream,
});

// Teams first (the games refer to them), then everything else, once. No scheduler loop: the
// answers never change, so there is nothing to refresh.
await scheduler.runNow('games:calendar');

const games = createGamesRepo(db);
const team = (abbr: string) => {
  const found = games.teams().find((t) => t.abbr === abbr);
  if (!found) throw new Error(`the recorded teams have no ${abbr}`);
  return found;
};
const side = (abbr: string, score: number | null, winner: boolean | null = null) => {
  const { id, name } = team(abbr);
  return { teamId: id, abbr, name, score, record: null, winner, linescores: [] };
};

const now = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// A game on right now, kept on today's date even when the tests run just after midnight.
let liveStart = now - 90 * MINUTE;
if (localDay(new Date(liveStart), config.timeZone) !== localDay(new Date(now), config.timeZone)) {
  liveStart = now - MINUTE;
}
const base = {
  season: 2027,
  seasonType: 'regular',
  period: null,
  clock: null,
  venue: 'Target Center',
} as const;
const seeded: Game[] = [
  {
    ...base,
    id: 'e2e-live',
    startUtc: new Date(liveStart).toISOString(),
    status: 'live',
    statusDetail: '4:12 - 3rd',
    period: 3,
    clock: '4:12',
    away: side('DEN', 58),
    home: side('MIN', 61),
  },
  {
    ...base,
    id: 'e2e-final',
    startUtc: new Date(now - 26 * HOUR).toISOString(),
    status: 'final',
    statusDetail: 'Final',
    away: side('GS', 118, false),
    home: side('POR', 123, true),
  },
  {
    ...base,
    id: 'e2e-next',
    startUtc: new Date(now + 3 * 24 * HOUR).toISOString(),
    status: 'scheduled',
    statusDetail: '',
    away: side('LAL', null),
    home: side('SAC', null),
  },
];
games.upsertGames(seeded);

for (const id of ['standings:refresh', 'news:espn', 'news:yahoo', 'news:cbs', 'news:reddit']) {
  await scheduler.runNow(id);
}
await scheduler.runNow('news:gigantes');
await scheduler.runNow('highlights:refresh');

await server.listen({ host: config.host, port: PORT });
console.log(`e2e server ready on http://127.0.0.1:${PORT}`);

const stop = () => void server.close().then(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
