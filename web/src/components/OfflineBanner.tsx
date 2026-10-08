import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { DEFAULT_TIME_ZONE } from '../lib/format';
import { offlineMessage, useNow, useOfflineState } from '../lib/offline';
import { useConfig, useHealth } from '../lib/queries';

/**
 * A thin band that says the app is showing stored data: "Sin conexión · actualizado hace 5 min".
 * It disappears by itself when the connection comes back (docs/design.md, state "Sin conexión"),
 * and the screen's data is asked for again at that moment.
 */
export function OfflineBanner() {
  const { offline, savedAt } = useOfflineState();
  const now = useNow();
  const timeZone = useConfig().data?.timeZone ?? DEFAULT_TIME_ZONE;

  // When the connection returns, look again at once. Without this, data that is still "fresh" by
  // the clock would keep showing the stored copy until its next scheduled refresh.
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries();
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [queryClient]);

  // Stored copies are on screen but the server answers again (it was down, not the phone): the
  // browser sends no "online" event for that, so the health check is what tells us.
  const health = useHealth();
  const showingCopies = savedAt !== null;
  const healthAnsweredAt = health.isSuccess ? health.dataUpdatedAt : 0;
  useEffect(() => {
    if (showingCopies && healthAnsweredAt > 0) void queryClient.invalidateQueries();
  }, [showingCopies, healthAnsweredAt, queryClient]);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="bg-warn/15 px-4 py-1.5 text-center text-[12px] font-semibold text-warn"
    >
      {offlineMessage(savedAt, now, timeZone)}
    </div>
  );
}
