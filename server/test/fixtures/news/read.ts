import { readFileSync } from 'node:fs';

/** Reads a recorded news response (see scripts/record-news-fixtures.mjs). */
export function readNewsFixture(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

export const readEspnNews = (): unknown => JSON.parse(readNewsFixture('espn-news.json'));
