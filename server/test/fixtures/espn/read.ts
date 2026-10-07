import { readFileSync } from 'node:fs';

/** Reads a recorded ESPN response (see scripts/record-espn-fixtures.mjs). */
export function readEspnFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
}
