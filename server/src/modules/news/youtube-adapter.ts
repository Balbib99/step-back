import { parseYoutubeFeed } from '../highlights/adapter.js';
import type { FeedItem } from './feed-item.js';

/** Where a YouTube video is watched: a Short has its own address, and that is what marks it. */
export const isShortUrl = (url: string): boolean =>
  /^https:\/\/www\.youtube\.com\/shorts\//.test(url);

/** A run of #hashtags at the end of a title is how a channel gets found, not part of what the video says. */
const TRAILING_HASHTAGS = /(?:\s+#[\p{L}\p{N}_]+)+\s*$/u;

export function withoutHashtags(title: string): string {
  const stripped = title.replace(TRAILING_HASHTAGS, '').trim();
  // A title that is only hashtags has nothing else to show.
  return stripped && !stripped.startsWith('#') ? stripped : title;
}

/**
 * The videos of a YouTube channel as news items: a video post with its thumbnail and the official
 * player to play it in the app. The description is left out on purpose: channels fill it with
 * hashtags, trip offers and links, which say nothing about the video (and would label it with
 * teams and cities it is not about). Only the title is read.
 */
export function parseYoutubeNews(xml: string): FeedItem[] {
  return parseYoutubeFeed(xml).map((video) => ({
    url: video.isShort
      ? `https://www.youtube.com/shorts/${video.ytId}`
      : `https://www.youtube.com/watch?v=${video.ytId}`,
    title: withoutHashtags(video.title),
    summary: null,
    publishedAt: video.publishedAt,
    mediaKind: 'video',
    mediaUrl: video.thumbnailUrl,
    embedUrl: `https://www.youtube-nocookie.com/embed/${video.ytId}`,
    durationSeconds: null,
    teamIds: [],
    playerNames: [],
  }));
}
