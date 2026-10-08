import type { PlayerLine } from '@step-back/shared';

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

/** The most points of anyone in the team: the player (or players) to set in bold. */
export function topScore(players: readonly PlayerLine[]): number | null {
  const scores = players.flatMap((p) => (p.points === null ? [] : [p.points]));
  const best = Math.max(...scores);
  return scores.length === 0 || best <= 0 ? null : best;
}
