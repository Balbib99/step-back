import type { TeamWithCrest } from '@step-back/shared';
import { Link } from 'react-router-dom';
import { bandTeam } from '../lib/news';
import { teamStyle } from '../lib/team-style';
import { TeamCrest } from './TeamCrest';

/** The coloured band of a post: the team it is about, or a plain one for the league. */
export function TeamBand({
  teams,
  favorites,
  byAbbr,
}: {
  teams: readonly string[];
  favorites: readonly string[];
  byAbbr: ReadonlyMap<string, TeamWithCrest>;
}) {
  const band = bandTeam(teams, favorites);
  if (!band) {
    return (
      <div className="flex min-h-9 items-center bg-surface-2 px-3 text-[13px] font-semibold text-text-2">
        NBA
      </div>
    );
  }
  const team = byAbbr.get(band.main);
  return (
    <Link
      to={`/equipo/${band.main}`}
      aria-label={`Ver ${team?.name ?? band.main}`}
      data-team={band.main}
      style={teamStyle(band.main)}
      className="team-field flex min-h-9 items-center gap-2 px-3 py-1 no-underline"
    >
      <TeamCrest abbr={band.main} src={team?.crestUrl} size={24} />
      <span className="voice-number team-numeral text-lg">{band.main}</span>
      <span className="voice-name min-w-0 flex-1 truncate text-[15px]">
        {team?.shortName ?? ''}
      </span>
      {band.others.length > 0 && (
        <span className="text-[12px] font-semibold opacity-80">
          {band.others.map((abbr) => (abbr === band.main ? '' : abbr)).join(' · ')}
        </span>
      )}
    </Link>
  );
}
