// Records real news responses as test fixtures (server/test/fixtures/news).
//   node scripts/record-news-fixtures.mjs [name...]
// With names, only the fixtures whose file name contains one of them are written. Running it
// again replaces the recorded items with today's, which changes what the tests see: do it on
// purpose. Items are cut down (a few of each feed, article bodies removed) so the files stay small.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'server',
  'test',
  'fixtures',
  'news',
);
const UA = 'step-back/0.1 (fixture recorder)';
const only = process.argv.slice(2);

async function get(url, accept) {
  const response = await fetch(url, { headers: { 'user-agent': UA, accept } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

function save(name, content) {
  if (only.length > 0 && !only.some((fragment) => name.includes(fragment))) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), content);
  console.log('wrote', name, `${content.length} bytes`);
}

/** Keeps the first `count` elements named `tag`, and what surrounds them. */
function keepFirst(xml, tag, count, shrink = (element) => element) {
  const pattern = new RegExp(`<${tag}[ >][\\s\\S]*?</${tag}>`, 'g');
  const all = xml.match(pattern) ?? [];
  const first = xml.indexOf(all[0]);
  const last = xml.lastIndexOf(all.at(-1)) + all.at(-1).length;
  return xml.slice(0, first) + all.slice(0, count).map(shrink).join('\n') + xml.slice(last);
}

// ---- ESPN: stories, headlines and video clips, with their team and player labels ----
const espn = JSON.parse(
  await get(
    'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=40',
    'application/json',
  ),
);
const articles = espn.articles.slice(0, 14).map((a) => ({
  type: a.type,
  headline: a.headline,
  description: a.description,
  published: a.published,
  images: (a.images ?? []).map(({ url, type }) => ({ url, type })),
  categories: (a.categories ?? [])
    .filter((c) => c.type === 'team' || c.type === 'athlete')
    .map(({ type, description, teamId, athleteId }) => ({ type, description, teamId, athleteId })),
  links: { web: { href: a.links?.web?.href } },
}));
save('espn-news.json', `${JSON.stringify({ articles }, null, 1)}\n`);

// ---- Yahoo Sports: RSS, pictures only inside the article text ----
const yahoo = await get('https://sports.yahoo.com/nba/rss/', 'application/rss+xml');
save(
  'yahoo.rss.xml',
  keepFirst(yahoo, 'item', 8, (item) =>
    // Keep the start of the article text (where the first picture is) and drop the rest.
    item.replace(
      /(<content:encoded><!\[CDATA\[)([\s\S]*?)(\]\]><\/content:encoded>)/,
      (_, a, body, c) => `${a}${body.slice(0, 1500)}${c}`,
    ),
  ),
);

// ---- CBS Sports: RSS with an <enclosure> picture ----
save(
  'cbs.rss.xml',
  keepFirst(
    await get('https://www.cbssports.com/rss/headlines/nba/', 'application/rss+xml'),
    'item',
    8,
  ),
);

// ---- r/nba: Atom, thumbnails as media:thumbnail ----
save(
  'reddit.atom.xml',
  keepFirst(
    await get('https://www.reddit.com/r/nba/.rss', 'application/atom+xml'),
    'entry',
    25,
    (entry) => entry.replace(/<content[\s\S]*?<\/content>/, ''),
  ),
);

// ---- Gigantes del Basket (the NBA section): RSS, WordPress ----
save(
  'gigantes.rss.xml',
  keepFirst(
    await get('https://www.gigantes.com/nba/feed/', 'application/rss+xml'),
    'item',
    10,
    (item) =>
      item.replace(
        /<content:encoded>[\s\S]*?<\/content:encoded>/,
        '<content:encoded></content:encoded>',
      ),
  ),
);
