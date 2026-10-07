import { useConfig, useTranslationStatus } from './queries';

/**
 * Whether posts in English can be translated: only when the server has a DeepL key, and not once
 * the credit is spent. `percent` lets a screen warn when it is nearly gone.
 */
export function useTranslationAvailability(): {
  available: boolean;
  blocked: boolean;
  percent: number | undefined;
} {
  const config = useConfig();
  const available = config.data?.features.translation === true;
  const status = useTranslationStatus(available);
  return {
    available,
    blocked: status.data?.blocked === true,
    percent: status.data?.percent ?? undefined,
  };
}
