import type { Game, GameStatus, GameTeam, SeasonType, Team } from '@step-back/shared';
import type { HttpClient } from '../../core/http.js';
import { EspnFormatError, parseWith } from '../espn-common.js';
import {
  espnSchedule,
  espnScoreboard,
  espnTeams,
  type EspnEvent,
  type EspnStatus,
} from './espn-schemas.js';

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

export { EspnFormatError };

// ---------------------------------------------------------------- mapping

function mapStatus(type: EspnStatus['type']): GameStatus {
  // The name comes first: a postponed game has state "post" but is not completed.
  if (type.name === 'STATUS_POSTPONED') return 'postponed';
  if (type.name === 'STATUS_CANCELED') return 'canceled';
  if (type.state === 'in') return 'live';
  if (type.state === 'post') return type.completed === false ? 'postponed' : 'final';
  return 'scheduled';
}

function mapSeasonType(code: number | undefined): SeasonType {
  switch (code) {
    case 1:
      return 'preseason';
    case 2:
      return 'regular';
    case 3:
    case 5: // play-in tournament
      return 'playoffs';
    default:
      throw new EspnFormatError('event', `unknown season type ${String(code)}`);
  }
}

function toIso(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) throw new EspnFormatError('event', `invalid date "${value}"`);
  return time.toISOString();
}

type EspnCompetitor = EspnEvent['competitions'][number]['competitors'][number];

function scoreOf(competitor: EspnCompetitor): number | null {
  const { score } = competitor;
  if (score === undefined) return null;
  const raw = typeof score === 'string' ? score : (score.displayValue ?? String(score.value ?? ''));
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

function recordOf(competitor: EspnCompetitor): string | null {
  const total = (competitor.records ?? competitor.record)?.find(
    (record) => record.type === 'total',
  );
  return total?.summary ?? total?.displayValue ?? null;
}

function mapCompetitor(competitor: EspnCompetitor, status: GameStatus): GameTeam {
  const started = status === 'live' || status === 'final';
  return {
    teamId: competitor.team.id,
    abbr: competitor.team.abbreviation,
    name: competitor.team.displayName,
    // ESPN reports "0" for a game that has not started; that is not a score.
    score: started ? scoreOf(competitor) : null,
    record: recordOf(competitor),
    winner: status === 'final' ? (competitor.winner ?? false) : null,
    linescores: started
      ? (competitor.linescores ?? []).map((line) => Math.round(line.value ?? 0))
      : [],
  };
}

function mapEvent(event: EspnEvent): Game {
  const competition = event.competitions[0]!;
  const espnStatus = competition.status ?? event.status;
  if (!espnStatus) throw new EspnFormatError('event', `game ${event.id} has no status`);

  const home = competition.competitors.find((c) => c.homeAway === 'home');
  const away = competition.competitors.find((c) => c.homeAway === 'away');
  if (!home || !away)
    throw new EspnFormatError('event', `game ${event.id} lacks a home or away team`);

  const status = mapStatus(espnStatus.type);
  const live = status === 'live';
  return {
    id: event.id,
    season: event.season.year,
    seasonType: mapSeasonType(event.seasonType?.type ?? event.season.type),
    startUtc: toIso(event.date),
    status,
    statusDetail: espnStatus.type.shortDetail ?? espnStatus.type.detail ?? '',
    period: live ? (espnStatus.period ?? null) : null,
    clock: live ? (espnStatus.displayClock ?? null) : null,
    venue: competition.venue?.fullName ?? null,
    home: mapCompetitor(home, status),
    away: mapCompetitor(away, status),
  };
}

// ------------------------------------------------------------------ parse

export function parseScoreboard(data: unknown): Game[] {
  return parseWith(espnScoreboard, data, 'scoreboard').events.map(mapEvent);
}

export function parseSchedule(data: unknown): Game[] {
  return parseWith(espnSchedule, data, 'team schedule').events.map(mapEvent);
}

export function parseTeams(data: unknown): Team[] {
  const parsed = parseWith(espnTeams, data, 'teams');
  return parsed.sports.flatMap((sport) =>
    sport.leagues.flatMap((league) =>
      league.teams.map(({ team }) => ({
        id: team.id,
        abbr: team.abbreviation,
        name: team.displayName,
        shortName: team.shortDisplayName,
        location: team.location,
        logoUrl:
          (team.logos?.find((logo) => logo.rel?.includes('default')) ?? team.logos?.[0])?.href ??
          null,
      })),
    ),
  );
}

// ------------------------------------------------------------------ fetch

/** ESPN groups the scoreboard by US Eastern calendar day: `date` is that day as YYYY-MM-DD. */
export async function fetchScoreboard(http: HttpClient, date: string): Promise<Game[]> {
  const dates = date.replaceAll('-', '');
  return parseScoreboard(await http.getJson(`${ESPN_BASE}/scoreboard`, { params: { dates } }));
}

/** `season` is the ending year (2027 = 2026-27); `seasonType` 1 preseason, 2 regular, 3 playoffs. */
export async function fetchTeamSchedule(
  http: HttpClient,
  teamId: string,
  season: number,
  seasonType?: 1 | 2 | 3,
): Promise<Game[]> {
  return parseSchedule(
    await http.getJson(`${ESPN_BASE}/teams/${teamId}/schedule`, {
      params: { season, seasontype: seasonType },
    }),
  );
}

export async function fetchTeams(http: HttpClient): Promise<Team[]> {
  return parseTeams(await http.getJson(`${ESPN_BASE}/teams`, { params: { limit: 40 } }));
}
