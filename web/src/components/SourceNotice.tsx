import { DEFAULT_TIME_ZONE } from '../lib/format';
import { timeAgo } from '../lib/news';
import { useConfig, useHealth } from '../lib/queries';
import { problemText, sourceProblem, type Section } from '../lib/sources';

/**
 * Says which source is not answering, on the screens that depend on it. The rest of the app keeps
 * working with what it had stored; this only tells the owner that what is on screen may be old.
 */
export function SourceNotice({ sections }: { sections: readonly Section[] }) {
  const health = useHealth();
  const config = useConfig();
  const now = new Date();
  const problem = sourceProblem(health.data, sections, now);
  if (!problem) return null;

  const timeZone = config.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const ago = problem.lastGoodAt ? timeAgo(problem.lastGoodAt, now, timeZone) : null;
  return (
    <p
      role="status"
      className="mt-3 rounded-card border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[13px] text-text-2"
    >
      <span aria-hidden="true" className="mr-1.5 text-warn">
        ●
      </span>
      {problemText(problem, ago)}
    </p>
  );
}
