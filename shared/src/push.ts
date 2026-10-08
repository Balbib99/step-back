import { z } from 'zod';

/** What `PushSubscription.toJSON()` gives the browser; the server needs nothing else. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });

/** Minutes before tip-off for the reminder; 0 is no reminder. */
export const REMINDER_OPTIONS = [0, 15, 30, 60] as const;
export const DEFAULT_REMINDER_MINUTES = 30;

export const teamPushSettingsSchema = z.object({
  team: z.string().regex(/^[A-Z]{2,4}$/),
  /** Tell me when the game starts. */
  start: z.boolean(),
  /** Tell me the result when it ends. */
  end: z.boolean(),
  reminderMinutes: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]),
});

/** One entry per favourite team. */
export const pushSettingsSchema = z.object({ teams: z.array(teamPushSettingsSchema) });

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export type TeamPushSettings = z.infer<typeof teamPushSettingsSchema>;
export type PushSettings = z.infer<typeof pushSettingsSchema>;

/** What subscribing and unsubscribing answer. */
export const pushAckSchema = z.object({ subscribed: z.boolean() });

/** The browser to send the test notification to. */
export const pushTestSchema = z.object({ endpoint: z.string().url().max(2048) });
export const pushTestAckSchema = z.object({ sent: z.boolean() });
