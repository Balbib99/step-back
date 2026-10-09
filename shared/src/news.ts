import { z } from 'zod';

export const newsLangSchema = z.enum(['en', 'es']);
export const newsMediaKindSchema = z.enum(['none', 'image', 'video']);

export const newsItemSchema = z.object({
  id: z.number().int(),
  /** Which configured source it came from (`sources.json`), such as "espn" or "gigantes". */
  sourceId: z.string(),
  /** The name to show, such as "ESPN" or "Gigantes del Basket". */
  sourceName: z.string(),
  /** The article or video at its source: the app only links to it, it never stores the article. */
  url: z.string().url(),
  title: z.string(),
  /** A short plain-text summary, if the source gives one. */
  summary: z.string().nullable(),
  lang: newsLangSchema,
  /** ISO 8601 UTC. */
  publishedAt: z.string(),
  /**
   * What the source attaches: an image, or a video (shown through its thumbnail). Without media
   * the post is text only.
   */
  mediaKind: newsMediaKindSchema,
  /** Where the server serves the picture from (`/api/news/:id/image`), never the third party. */
  imageUrl: z.string().nullable(),
  /** A player that can be embedded in the page (YouTube); absent when the video only opens at its source. */
  embedUrl: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  /** A YouTube Short: a vertical video of under a minute, shown in its own section. */
  short: z.boolean().default(false),
  /** Abbreviations of the teams it is about. */
  teams: z.array(z.string()),
  /** Names of the players it is about. */
  players: z.array(z.string()),
});

export const newsResponseSchema = z.object({
  news: z.array(newsItemSchema),
  /** Pass it as `before` to get the next page; null when there is nothing older. */
  nextBefore: z.string().nullable(),
});

export type NewsLang = z.infer<typeof newsLangSchema>;
export type NewsMediaKind = z.infer<typeof newsMediaKindSchema>;
export type NewsItem = z.infer<typeof newsItemSchema>;
export type NewsResponse = z.infer<typeof newsResponseSchema>;
