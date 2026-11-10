/**
 * Pure mappings from BALLDONTLIE's PGA TOUR responses to the provider port's shapes. No I/O:
 * the adapter fetches, these reshape. Anything the documented data cannot answer is a
 * `BalldontlieContractError`, never a guess.
 */

import { ParticipantRoundStatus, Sport } from '@poolmaster/shared/domain';
import type { GolfRoundUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import {
  PgaCompetitorType,
  PgaFormatType,
  PgaStatusState,
  type PgaPlayer,
  type PgaPlayerSummary,
  type PgaResultRound,
  type PgaTournament,
  type PgaTournamentCompetitor,
  type PgaTournamentResult,
} from './pga-contract';

export const BALLDONTLIE_PROVIDER_ID = 'balldontlie';

/**
 * The tour name events carry in `metadata.tour`, matched against a sport league's
 * matchKeyword (#385). It is the PGA TOUR sport league's own name, so that league finds
 * these events with no keyword set by hand.
 */
export const PGA_TOUR_NAME = 'PGA TOUR';

/**
 * The port's event status for each vendor lifecycle state. `unknown` has none: the vendor
 * says it "cannot be safely classified", so such a tournament is left out of a browse and
 * refused by a detail read rather than shown with a status we made up.
 */
const EVENT_STATUS_BY_STATE: Readonly<Record<Exclude<PgaStatusState, 'unknown'>, SportEvent['status']>> = {
  [PgaStatusState.SCHEDULED]: 'SCHEDULED',
  [PgaStatusState.IN_PROGRESS]: 'IN_PROGRESS',
  // A delay or suspension pauses a tournament that has started; it resumes, so it is live.
  [PgaStatusState.DELAYED]: 'IN_PROGRESS',
  [PgaStatusState.SUSPENDED]: 'IN_PROGRESS',
  [PgaStatusState.FINAL]: 'COMPLETED',
  [PgaStatusState.POSTPONED]: 'POSTPONED',
  [PgaStatusState.CANCELED]: 'CANCELLED',
  [PgaStatusState.ABANDONED]: 'CANCELLED',
};

export function isClassifiedTournament(tournament: PgaTournament): boolean {
  return tournament.status_state !== PgaStatusState.UNKNOWN;
}

/** A vendor date (`YYYY-MM-DD`) as midnight UTC, the way every other provider date is stored. */
function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function toSportEvent(tournament: PgaTournament, participantCount?: number): SportEvent {
  if (tournament.status_state === PgaStatusState.UNKNOWN) {
    throw new BalldontlieContractError(
      `/pga/v2/tournaments ${String(tournament.id)}`,
      ['status_state is "unknown", which the vendor documents as not safely classifiable'],
    );
  }
  const location = [tournament.city, tournament.state, tournament.country].filter(Boolean).join(', ');
  return {
    externalId: String(tournament.id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.GOLF,
    name: tournament.name,
    venue: tournament.course_name ?? undefined,
    location: location || undefined,
    startDate: toUtcDate(tournament.start_date),
    endDate: tournament.end_date ? toUtcDate(tournament.end_date) : undefined,
    status: EVENT_STATUS_BY_STATE[tournament.status_state],
    rounds: tournament.rounds.length > 0 ? tournament.rounds.length : undefined,
    participantCount,
    // Once play starts the field cannot change.
    fieldLocked: tournament.status_state !== PgaStatusState.SCHEDULED,
    metadata: {
      tour: PGA_TOUR_NAME,
      season: tournament.season,
      formatType: tournament.format_type,
    },
  };
}

/** PoolMaster's golf scoring is individual stroke play; any other format is refused, not approximated. */
export function requireStrokePlay(tournament: PgaTournament): void {
  if (tournament.format_type !== PgaFormatType.STROKE_PLAY) {
    throw new UnsupportedPgaFormatError(tournament.id, tournament.format_type);
  }
}

export class UnsupportedPgaFormatError extends Error {
  constructor(readonly tournamentId: number, readonly formatType: string | null) {
    super(`BALLDONTLIE tournament ${String(tournamentId)} is ${formatType ?? 'of no stated format'}; only STROKE_PLAY tournaments can be scored.`);
    this.name = 'UnsupportedPgaFormatError';
  }
}

function requirePlayer(path: string, player: PgaPlayerSummary | null, competitorId: number): PgaPlayerSummary {
  if (!player) {
    throw new BalldontlieContractError(path, [`competitor ${String(competitorId)} is a PLAYER with no player`]);
  }
  return player;
}

/** The name fields a golfer is built from, from either player shape; only the id and name are sure. */
type GolferNames = Pick<PgaPlayerSummary, 'id' | 'display_name'>
  & Partial<Pick<PgaPlayerSummary, 'first_name' | 'last_name' | 'country_code'>>;

function toGolfer(
  player: GolferNames,
  details: { active: boolean; ranking: number | undefined; metadata: ProviderParticipant['metadata'] },
): ProviderParticipant {
  return {
    externalId: String(player.id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.GOLF,
    name: player.display_name,
    firstName: player.first_name ?? undefined,
    lastName: player.last_name ?? undefined,
    nationality: player.country_code ?? undefined,
    ...details,
  };
}

/**
 * The field: one participant per PLAYER competitor, keyed by the vendor's player id (stable
 * across tournaments, so one participant mapping serves every event). `owgrByPlayerId` carries
 * each player's world ranking, which the field's tiers are built from.
 */
export function toFieldParticipants(
  competitors: readonly PgaTournamentCompetitor[],
  owgrByPlayerId: ReadonlyMap<number, number | null>,
): ProviderParticipant[] {
  return competitors
    .filter((competitor) => competitor.type === PgaCompetitorType.PLAYER)
    .map((competitor) => {
      const player = requirePlayer('/pga/v2/tournament_competitors', competitor.player, competitor.id);
      return toGolfer(player, {
        active: true,
        ranking: owgrByPlayerId.get(player.id) ?? undefined,
        metadata: { competitorId: competitor.id },
      });
    });
}

/** The PLAYER competitors' player ids, for the ranking lookup. */
export function fieldPlayerIds(competitors: readonly PgaTournamentCompetitor[]): number[] {
  return competitors
    .filter((competitor) => competitor.type === PgaCompetitorType.PLAYER)
    .map((competitor) => requirePlayer('/pga/v2/tournament_competitors', competitor.player, competitor.id).id);
}

/**
 * A golfer from the tour's player list. The list is read with `active=true`, so a player whose
 * `active` flag is missing is active by that request.
 */
export function toTourParticipant(player: PgaPlayer): ProviderParticipant {
  return toGolfer(player, { active: player.active ?? true, ranking: player.owgr ?? undefined, metadata: {} });
}

/** Positions that mean a golfer is out, and the status their last played round takes. */
const OUT_STATUS_BY_POSITION: ReadonlyMap<string, ParticipantRoundStatus> = new Map([
  ['CUT', ParticipantRoundStatus.MISSED_CUT],
  ['WD', ParticipantRoundStatus.DNF],
  ['DQ', ParticipantRoundStatus.DSQ],
]);

/** A place on the leaderboard, tied or not: `1`, `T4`. */
const PLACE_PATTERN = /^T?\d{1,3}$/;

/**
 * Why a golfer is out, or undefined while they are still in it (a place, or no position yet).
 * Any other position is refused rather than read as still playing.
 */
function readOutStatus(path: string, position: string | null): ParticipantRoundStatus | undefined {
  if (position === null || PLACE_PATTERN.test(position)) {
    return undefined;
  }
  const outStatus = OUT_STATUS_BY_POSITION.get(position);
  if (!outStatus) {
    throw new BalldontlieContractError(path, [`position "${position}" is neither a place nor one of ${[...OUT_STATUS_BY_POSITION.keys()].join(', ')}`]);
  }
  return outStatus;
}

/** `thru` while a round is played: the holes completed, with a `*` when the golfer started on the back nine. */
const HOLES_THRU_PATTERN = /^(\d{1,2})\*?$/;
const FINISHED_THRU = 'F';
const HOLES_IN_ROUND = 18;

type RoundProgress =
  | { status: typeof ParticipantRoundStatus.COMPLETED }
  | { status: typeof ParticipantRoundStatus.IN_PROGRESS; thru?: number };

function readThru(path: string, thru: string | null): RoundProgress {
  if (thru === null) {
    return { status: ParticipantRoundStatus.IN_PROGRESS };
  }
  if (thru === FINISHED_THRU) {
    return { status: ParticipantRoundStatus.COMPLETED };
  }
  const holes = HOLES_THRU_PATTERN.exec(thru);
  if (!holes) {
    throw new BalldontlieContractError(path, [`thru "${thru}" is neither "F" nor a hole count`]);
  }
  const completed = Number(holes[1]);
  if (completed > HOLES_IN_ROUND) {
    throw new BalldontlieContractError(path, [`thru "${thru}" is more than ${String(HOLES_IN_ROUND)} holes`]);
  }
  return completed === HOLES_IN_ROUND
    ? { status: ParticipantRoundStatus.COMPLETED }
    : { status: ParticipantRoundStatus.IN_PROGRESS, thru: completed };
}

/** The par of the course a round is played on, when the tournament names exactly one with a par. */
function courseParForRound(tournament: PgaTournament, roundNumber: number): number | null {
  const pars = tournament.courses
    .filter((entry) => entry.rounds.includes(roundNumber))
    .map((entry) => entry.course.par ?? null);
  return pars.length === 1 ? pars[0] : null;
}

function roundScoreToPar(path: string, tournament: PgaTournament, round: PgaResultRound): number {
  if (round.par_relative_score !== null) {
    return round.par_relative_score;
  }
  const par = courseParForRound(tournament, round.round_number);
  if (round.score === null || par === null) {
    throw new BalldontlieContractError(path, [
      `round ${String(round.round_number)} has no par_relative_score and no single course par to work it out from`,
    ]);
  }
  return round.score - par;
}

function isPlayed(round: PgaResultRound): boolean {
  return round.score !== null || round.par_relative_score !== null;
}

/**
 * One golf round update per round a golfer has started. A round before the current one, or
 * any round once the tournament is final, is COMPLETED; the current round reads `thru`. A
 * golfer who is out (CUT, WD, DQ) has their last played round marked with why.
 */
export function toGolfRoundUpdates(
  tournament: PgaTournament,
  results: readonly PgaTournamentResult[],
): GolfRoundUpdate[] {
  const path = `/pga/v2/tournament_results ${String(tournament.id)}`;
  const tournamentFinal = tournament.status_state === PgaStatusState.FINAL;
  return results.flatMap((result) => {
    if (result.competitor.type !== PgaCompetitorType.PLAYER) {
      throw new BalldontlieContractError(path, [
        `a STROKE_PLAY result has a ${result.competitor.type} competitor (${String(result.competitor.id)})`,
      ]);
    }
    const player = requirePlayer(path, result.competitor.player, result.competitor.id);
    const played = result.rounds
      .filter(isPlayed)
      .sort((a, b) => a.round_number - b.round_number);
    const outStatus = readOutStatus(path, result.position);
    const lastPlayed = played.at(-1)?.round_number;

    return played.map((round): GolfRoundUpdate => {
      const base = {
        participantExternalId: String(player.id),
        round: round.round_number,
        strokes: round.score,
        scoreToPar: roundScoreToPar(path, tournament, round),
      };
      if (outStatus && round.round_number === lastPlayed) {
        return { ...base, status: outStatus };
      }
      const progress = roundProgress(path, tournamentFinal, result, round.round_number);
      return { ...base, ...progress };
    });
  });
}

function roundProgress(
  path: string,
  tournamentFinal: boolean,
  result: PgaTournamentResult,
  roundNumber: number,
): RoundProgress {
  if (tournamentFinal || result.current_round === null || roundNumber < result.current_round) {
    return { status: ParticipantRoundStatus.COMPLETED };
  }
  if (roundNumber === result.current_round) {
    return readThru(path, result.thru);
  }
  throw new BalldontlieContractError(path, [
    `player ${String(result.competitor.id)} has a score for round ${String(roundNumber)}, after their current round ${String(result.current_round)}`,
  ]);
}
