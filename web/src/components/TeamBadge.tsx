import { teamStyle } from '../lib/team-style';

/** A team's abbreviation as a small jersey tag, painted from its palette. */
export function TeamBadge({ abbr }: { abbr: string }) {
  return (
    <span
      data-team={abbr}
      style={teamStyle(abbr)}
      className="team-field inline-flex min-h-9 items-center rounded-card px-3"
    >
      <span className="voice-number team-numeral text-xl">{abbr}</span>
    </span>
  );
}
