// Records the real YouTube feed of the official NBA channel (server/test/fixtures/highlights).
//   node scripts/record-highlights-fixtures.mjs
// The feed only holds the channel's latest 15 videos, so each recording is a snapshot of that moment.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHANNEL_ID = 'UCWJ2lWNubArHWmf3FIHbfcQ';
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'server',
  'test',
  'fixtures',
  'highlights',
);

const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`, {
  headers: { 'user-agent': 'step-back/0.1 (fixture recorder)', accept: 'application/atom+xml' },
});
if (!response.ok) throw new Error(`YouTube answered ${response.status}`);
// The star ratings and view counts change every minute and the adapter does not read them.
const xml = (await response.text()).replace(/\s*<media:community>[\s\S]*?<\/media:community>/g, '');

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'nba-channel.atom.xml'), xml);
console.log('wrote nba-channel.atom.xml', xml.length, 'bytes');
