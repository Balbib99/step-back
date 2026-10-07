import { z } from 'zod';

/** The Spanish version of a news item's title and summary. */
export const translationResponseSchema = z.object({
  title: z.string(),
  summary: z.string().nullable(),
  /** True when it came from the short-lived cache and used none of the translation quota. */
  cached: z.boolean(),
});

/** How much of the translation quota is used. The numbers are null when DeepL cannot be asked. */
export const translationStatusSchema = z.object({
  /** False when there is no API key: the app shows no translate button at all. */
  enabled: z.boolean(),
  used: z.number().nullable(),
  limit: z.number().nullable(),
  /** 0 to 100. */
  percent: z.number().nullable(),
  /** True when the quota is spent: translating is off until it renews or grows. */
  blocked: z.boolean(),
});

export type TranslationResponse = z.infer<typeof translationResponseSchema>;
export type TranslationStatus = z.infer<typeof translationStatusSchema>;
