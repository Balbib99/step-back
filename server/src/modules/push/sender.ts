import type { Game, NewsItem } from '@step-back/shared';
import webpush from 'web-push';
import type { Logger } from '../../core/logger.js';
import {
  detectEvents,
  detectNews,
  END_NEWS_FOR_MS,
  MAX_NEWS_PER_DAY,
  MAX_REMINDER_MS,
  type PushKind,
} from './detector.js';
import { messageFor, newsMessageFor, type PushPayload } from './messages.js';
import type { PushRepo, StoredSubscription } from './repo.js';

const DAY_MS = 24 * 60 * 60_000;

/** How long the push service keeps a notification for a phone that is off or out of coverage. */
const TTL_SECONDS: Record<PushKind | 'news', number> = {
  reminder: 15 * 60,
  start: 30 * 60,
  end: 6 * 60 * 60,
  news: 2 * 60 * 60,
};

/** Sends one notification to one browser. Rejects with an error carrying `statusCode` when the service refuses. */
export interface PushProvider {
  send(subscription: StoredSubscription, payload: PushPayload, ttlSeconds: number): Promise<void>;
}

/** The real provider: the browsers' push services, through the `web-push` library. */
export function createWebPushProvider(vapid: {
  publicKey: string;
  privateKey: string;
  subject: string;
}): PushProvider {
  return {
    send: async (subscription, payload, ttlSeconds) => {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { vapidDetails: vapid, TTL: ttlSeconds, urgency: 'high', timeout: 15_000 },
      );
    },
  };
}

/** 404 and 410: the subscription no longer exists (app uninstalled, permission withdrawn). */
const isGone = (error: unknown) => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return status === 404 || status === 410;
};

export interface DispatchResult {
  /** Events found due and not sent before. */
  events: number;
  delivered: number;
  removed: number;
}

export interface Dispatcher {
  /** Looks for due notifications and sends each one once. A failing browser never stops the rest. */
  run(): Promise<DispatchResult>;
}

export function createDispatcher(deps: {
  repo: PushRepo;
  /** Games of any team between two instants (ISO UTC). */
  games: (fromUtc: string, toUtc: string) => Game[];
  /** The newest news of the given teams. */
  news: (teams: readonly string[]) => NewsItem[];
  provider: PushProvider;
  favorites: readonly string[];
  /** Ids of the news sources whose items may be sent. */
  prioritySources: ReadonlySet<string>;
  sourceName: (sourceId: string) => string;
  timeZone: string;
  logger: Logger;
  now?: () => number;
}): Dispatcher {
  const { repo, provider, favorites, logger } = deps;
  const now = deps.now ?? (() => Date.now());

  /** Sends one event to every browser, once. */
  async function deliver(
    key: string,
    payload: PushPayload,
    ttl: number,
    result: DispatchResult,
  ): Promise<void> {
    // Claimed before sending: if the process dies halfway, the notification is missed rather
    // than repeated. Released again below only when nobody at all could be reached.
    if (!repo.claim(key)) return;
    result.events += 1;

    const subscriptions = repo.subscriptions();
    const outcomes = await Promise.allSettled(
      subscriptions.map((subscription) => provider.send(subscription, payload, ttl)),
    );

    let delivered = 0;
    let failed = 0;
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        delivered += 1;
      } else if (isGone(outcome.reason)) {
        repo.deleteSubscription(subscriptions[index]!.endpoint);
        result.removed += 1;
      } else {
        failed += 1;
        const err =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        logger.warn({ err }, 'push could not be delivered');
      }
    });

    result.delivered += delivered;
    if (delivered === 0 && failed > 0) repo.release(key); // try again on the next run
  }

  return {
    run: async () => {
      const at = now();
      const settings = repo.settings();
      const result: DispatchResult = { events: 0, delivered: 0, removed: 0 };

      const games = deps.games(
        new Date(at - END_NEWS_FOR_MS).toISOString(),
        new Date(at + MAX_REMINDER_MS + 1).toISOString(),
      );
      for (const event of detectEvents(games, settings, at)) {
        await deliver(event.key, messageFor(event, deps.timeZone), TTL_SECONDS[event.kind], result);
      }

      const due = detectNews(deps.news(favorites), settings, favorites, deps.prioritySources, at);
      if (due.length > 0) {
        // A cap per day keeps a busy news day from turning into a flood.
        let room = MAX_NEWS_PER_DAY - repo.countClaimed('news:', at - DAY_MS);
        for (const event of due) {
          if (room <= 0) break;
          const before = result.events;
          await deliver(
            event.key,
            newsMessageFor(event, deps.sourceName(event.item.sourceId)),
            TTL_SECONDS.news,
            result,
          );
          if (result.events > before) room -= 1;
        }
      }

      if (result.events > 0 || result.removed > 0) logger.info(result, 'push dispatched');
      return result;
    },
  };
}
