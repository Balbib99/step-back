import type { PlayerLine, StatLine } from '@step-back/shared';

/** A number, or a dash where there is none (a player who did not play). */
export const stat = (value: number | string | null): string =>
  value === null ? '–' : String(value);

/** +5, -3, 0: the sign is part of the number. */
export const signed = (value: number | null): string =>
  value === null ? '–' : value > 0 ? `+${value}` : String(value);

// ESPN's reasons for not playing, in the words of the app. Anything else is shown as ESPN says it.
const REASONS: Record<string, string> = {
  "COACH'S DECISION": 'decisión técnica',
  'INJURY/ILLNESS': 'lesión o enfermedad',
  INJURY: 'lesión',
  ILLNESS: 'enfermedad',
  REST: 'descanso',
  'PERSONAL REASON': 'motivos personales',
  'NOT WITH TEAM': 'fuera del equipo',
  SUSPENSION: 'sanción',
};

export function reasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return REASONS[reason.trim().toUpperCase()] ?? reason.trim().toLowerCase();
}

/** The most points of anyone in the team: the player (or players) to mark. */
export function topScore(players: readonly PlayerLine[]): number | null {
  const scores = players.flatMap((p) => (p.points === null ? [] : [p.points]));
  const best = Math.max(...scores);
  return scores.length === 0 || best <= 0 ? null : best;
}

/** "M. Leons" -> "ML", "R. Williams III" -> "RW". */
export function initialsOf(shortName: string): string {
  return shortName
    .replaceAll('.', '')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}

/** The shooting of a line, for the "Más datos" view: ["TC 8-15", "T3 2-5", "TL 4-4"]. */
export const shootingParts = (line: StatLine): string[] => [
  `TC ${stat(line.fieldGoals)}`,
  `T3 ${stat(line.threePointers)}`,
  `TL ${stat(line.freeThrows)}`,
];

/** The shooting and the plus-minus of a player: ["TC 8-15", "T3 2-5", "TL 4-4", "+/- +7"]. */
export const detailParts = (line: StatLine): string[] => [
  ...shootingParts(line),
  `+/- ${signed(line.plusMinus)}`,
];

/** How much a bench player did, to size his bar against the others of his bench. */
export const contribution = (p: Pick<StatLine, 'points' | 'rebounds' | 'assists'>): number =>
  (p.points ?? 0) + (p.rebounds ?? 0) + (p.assists ?? 0);
