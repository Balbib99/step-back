import { newsLangSchema } from '@step-back/shared';
import { z } from 'zod';
import raw from './sources.json';

// A news source is a line of `sources.json`: adding one needs no code.
export const sourceSchema = z.object({
  /** Lower case letters, digits and dashes; it also names the source's scheduled job. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  lang: newsLangSchema,
  /** `espn` is ESPN's own news API; `feed` is any RSS or Atom feed. */
  type: z.enum(['espn', 'feed']),
  url: z.string().url(),
  /** Use the first picture of the article text when the item has no media tags (Yahoo). */
  imageFromContent: z.boolean().optional(),
  /** Titles to leave out, as regular expressions (r/nba's daily threads). */
  skipTitles: z.array(z.string()).optional(),
});

export type NewsSource = z.infer<typeof sourceSchema>;

/** Checks a list of sources: valid lines, unique ids, patterns that compile. */
export function parseSources(data: unknown): NewsSource[] {
  const sources = z.array(sourceSchema).parse(data);
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.id)) throw new Error(`news source "${source.id}" appears twice`);
    seen.add(source.id);
    for (const pattern of source.skipTitles ?? []) {
      try {
        new RegExp(pattern);
      } catch {
        throw new Error(`news source "${source.id}": "${pattern}" is not a valid pattern`);
      }
    }
  }
  return sources;
}

export const SOURCES: NewsSource[] = parseSources(raw);
