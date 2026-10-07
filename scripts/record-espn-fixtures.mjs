// Records real ESPN responses as test fixtures (server/test/fixtures/espn).
//   node scripts/record-espn-fixtures.mjs
// Noise the adapter never reads (links, statistics, leaders, ...) is stripped so the files stay small.
// The only synthetic fixture is the live game: there is rarely a game in progress when this runs, so
// it is derived from a real scheduled event by `deriveLive` below.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'server',
  'test',
  'fixtures',
  'espn',
);

const NOISE = new Set([
  'links',
  'statistics',
  'leaders',
  'geoBroadcasts',
  'broadcasts',
  'tracking',
  'ad',
  'deviceRestrictions',
  'geoRestrictions',
  'timeRestrictions',
  'uid',
  'clubhouse',
  'groups',
  'seasonSummary',
  'standingSummary',
  'recordSummary',
  'tickets',
  'odds',
  'format',
  'logoDark',
]);

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !NOISE.has(key))
        .map(([key, inner]) => [
          key,
          // Each team carries a dozen logo variants; the adapter only reads the default one.
          key === 'logos' && Array.isArray(inner)
            ? inner.filter((logo) => logo.rel?.includes('default')).map(strip)
            : strip(inner),
        ]),
    );
  }
  return value;
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': 'step-back/0.1 (fixture recorder)', accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

function save(name, data) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), `${JSON.stringify(strip(data), null, 1)}\n`);
  console.log('wrote', name);
}

// A real scheduled event turned into a game in the 3rd quarter (78-74).
function deriveLive(scheduled) {
  const live = structuredClone(scheduled);
  const event = live.events[0];
  const status = {
    clock: 252,
    displayClock: '4:12',
    period: 3,
    type: {
      id: '2',
      name: 'STATUS_IN_PROGRESS',
      state: 'in',
      completed: false,
      description: 'In Progress',
      detail: '4:12 - 3rd Quarter',
      shortDetail: '4:12 - 3rd',
    },
  };
  event.status = status;
  const competition = event.competitions[0];
  competition.status = status;
  const [home, away] = competition.competitors;
  home.score = '78';
  away.score = '74';
  home.linescores = [24, 30, 24].map((v, i) => ({
    value: v,
    displayValue: String(v),
    period: i + 1,
  }));
  away.linescores = [27, 25, 22].map((v, i) => ({
    value: v,
    displayValue: String(v),
    period: i + 1,
  }));
  live.events = [event];
  return live;
}

const teams = await get('/teams?limit=40');
save('teams.json', teams);

save('scoreboard-final.json', await get('/scoreboard?dates=20261006'));
const scheduled = await get('/scoreboard?dates=20261008');
save('scoreboard-scheduled.json', scheduled);
save('scoreboard-live.synthetic.json', deriveLive(scheduled));
// Jan 2025: the Los Angeles wildfires postponed Hornets at Lakers.
save('scoreboard-postponed.json', await get('/scoreboard?dates=20250109'));

save('schedule-min-preseason.json', await get('/teams/16/schedule?season=2027&seasontype=1'));
// Portland hosts a club from London (not an NBA team) in the preseason.
save('schedule-por-preseason.json', await get('/teams/22/schedule?season=2027&seasontype=1'));
// The day MIN @ MIL (also in the schedule fixture) was played: the same game seen through both endpoints.
save('scoreboard-min-mil-day.json', await get('/scoreboard?dates=20261005'));
