import { z } from 'zod';
import { gameSchema } from './games.js';

export const highlightKindSchema = z.enum(['full_highlights', 'clip']);

export const highlightSchema = z.object({
  id: z.number().int(),
  /** The YouTube video id. */
  ytId: z.string(),
  title: z.string(),
  /** ISO 8601 UTC. */
  publishedAt: z.string(),
  /** A summary of a whole game, or a single play or clip. */
  kind: highlightKindSchema,
  /** The game a full highlights video belongs to, when it could be linked. */
  gameId: z.string().nullable(),
  /** Where the server serves the thumbnail from, never YouTube. */
  thumbnailUrl: z.string(),
  /** The privacy-friendly player (youtube-nocookie.com) to embed in the page. */
  embedUrl: z.string(),
  /** The video on YouTube, for when the embed does not play. */
  watchUrl: z.string(),
  /** YouTube Shorts are vertical. */
  isShort: z.boolean(),
  teams: z.array(z.string()),
  players: z.array(z.string()),
});

export const highlightsResponseSchema = z.object({
  highlights: z.array(highlightSchema),
  /** Pass it as `before` to get the next page; null when there is nothing older. */
  nextBefore: z.string().nullable(),
});

/** The videos of one game: possibly none yet, which is not an error. */
export const gameHighlightsResponseSchema = z.object({
  game: gameSchema,
  highlights: z.array(highlightSchema),
});

export type HighlightKind = z.infer<typeof highlightKindSchema>;
export type Highlight = z.infer<typeof highlightSchema>;
export type HighlightsResponse = z.infer<typeof highlightsResponseSchema>;
export type GameHighlightsResponse = z.infer<typeof gameHighlightsResponseSchema>;
