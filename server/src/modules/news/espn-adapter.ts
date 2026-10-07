import { z } from 'zod';
import type { HttpClient } from '../../core/http.js';
import { parseWith } from '../espn-common.js';
import type { FeedItem } from './feed-item.js';
import { cleanSummary, cleanTitle, normalizeUrl } from './text.js';

export const ESPN_NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news';

const imageSchema = z.object({ url: z.string(), type: z.string().optional() });

const categorySchema = z.object({
  type: z.string(),
  description: z.string().optional(),
  teamId: z.union([z.string(), z.number()]).optional(),
  athleteId: z.union([z.string(), z.number()]).optional(),
});

const articleSchema = z.object({
  type: z.string(),
  headline: z.string(),
  description: z.string().optional(),
  published: z.string().optional(),
  images: z.array(imageSchema).optional(),
  categories: z.array(categorySchema).optional(),
  links: z.object({ web: z.object({ href: z.string().optional() }).optional() }).optional(),
});

const newsSchema = z.object({ articles: z.array(articleSchema) });

/** A piece about more teams than this (the power rankings list all 30) is about the league. */
const MAX_TEAMS_PER_ITEM = 4;

function teamsOf(categories: z.infer<typeof categorySchema>[]): string[] {
  const ids = categories
    .filter((c) => c.type === 'team' && c.teamId !== undefined)
    .map((c) => String(c.teamId));
  return ids.length > MAX_TEAMS_PER_ITEM ? [] : ids;
}

/**
 * ESPN's NBA news: stories (`Story`, `HeadlineNews`) with a photo and "Media" items, which are
 * video clips whose picture is the thumbnail. ESPN labels each one with its teams and players,
 * so those are not guessed from the text.
 */
export function parseEspnNews(data: unknown): FeedItem[] {
  const { articles } = parseWith(newsSchema, data, 'news');
  const items: FeedItem[] = [];
  for (const article of articles) {
    const url = normalizeUrl(article.links?.web?.href ?? '');
    const title = cleanTitle(article.headline);
    if (!url || !title) continue;

    const isVideo = article.type === 'Media';
    const images = article.images ?? [];
    const picture = (isVideo ? images[0] : (images.find((i) => i.type === 'header') ?? images[0]))
      ?.url;
    const mediaUrl = picture ? normalizeUrl(picture) : undefined;
    const published = article.published ? Date.parse(article.published) : NaN;
    // A clip's description just repeats its headline.
    const summary = cleanSummary(article.description);

    items.push({
      url,
      title,
      summary: summary && summary !== title ? summary : null,
      publishedAt: Number.isFinite(published) ? published : null,
      mediaKind: isVideo ? 'video' : mediaUrl ? 'image' : 'none',
      mediaUrl: mediaUrl ?? null,
      embedUrl: null,
      durationSeconds: null,
      teamIds: teamsOf(article.categories ?? []),
      playerNames: (article.categories ?? [])
        .filter((c) => c.type === 'athlete' && c.description)
        .map((c) => c.description!),
    });
  }
  return items;
}

export async function fetchEspnNews(http: HttpClient): Promise<FeedItem[]> {
  return parseEspnNews(await http.getJson(ESPN_NEWS_URL, { params: { limit: 40 } }));
}
