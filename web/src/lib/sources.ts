import type { HealthResponse } from '@step-back/shared';

/** The parts of the app that live off an outside source. */
export type Section = 'games' | 'standings' | 'news' | 'highlights';

// What each scheduled job feeds, and how to call its source. A job that is not here is not shown.
const JOBS: Record<string, { section: Section; source: string }> = {
  'games:calendar': { section: 'games', source: 'el calendario de ESPN' },
  'games:refresh': { section: 'games', source: 'los marcadores de ESPN' },
  'standings:refresh': { section: 'standings', source: 'la clasificación de ESPN' },
  'news:espn': { section: 'news', source: 'ESPN' },
  'news:yahoo': { section: 'news', source: 'Yahoo Sports' },
  'news:cbs': { section: 'news', source: 'CBS Sports' },
  'news:reddit': { section: 'news', source: 'r/nba' },
  'news:gigantes': { section: 'news', source: 'Gigantes del Basket' },
  'highlights:refresh': { section: 'highlights', source: 'el canal de la NBA en YouTube' },
};

/**
 * One failed attempt is not news: sources hiccup and the server tries again by itself. A source
 * is reported once its last good answer is this old (or it has never answered).
 */
export const GRACE_MS = 15 * 60_000;

export interface SourceProblem {
  /** "ESPN", "Yahoo Sports"... */
  sources: string[];
  /** When the oldest of them last answered well; null when one never has. */
  lastGoodAt: string | null;
}

/** The sources of a section that have been failing for a while, or undefined when all is well. */
export function sourceProblem(
  health: HealthResponse | undefined,
  sections: readonly Section[],
  now: Date,
): SourceProblem | undefined {
  const failing = (health?.jobs ?? []).filter((job) => {
    const known = JOBS[job.id];
    if (!known || !sections.includes(known.section) || job.status !== 'error') return false;
    return !job.lastSuccessAt || now.getTime() - Date.parse(job.lastSuccessAt) > GRACE_MS;
  });
  if (failing.length === 0) return undefined;

  const goods = failing.map((job) => job.lastSuccessAt);
  const lastGoodAt = goods.some((at) => at === null)
    ? null
    : (goods.filter((at): at is string => at !== null).sort()[0] ?? null);
  return { sources: [...new Set(failing.map((job) => JOBS[job.id]!.source))], lastGoodAt };
}

const joinNames = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;

/** What to tell the owner, in Spanish. `ago` is "hace 2 h", "ayer" or "5 oct", when known. */
export function problemText(problem: SourceProblem, ago: string | null): string {
  const what = `No se está pudiendo actualizar desde ${joinNames(problem.sources)}.`;
  return ago
    ? `${what} Lo que ves puede no estar al día (último dato correcto: ${ago}).`
    : `${what} Puede que lo que ves esté vacío o incompleto.`;
}
