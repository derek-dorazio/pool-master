/**
 * What the golf leaderboard and golf settlement both read, on ports (#247): the event's field
 * as golf rows, the contest's counting and scoring configuration, and its active entries with
 * their picks. One set of reads for both, so the live leaderboard and the settled result cannot
 * drift apart.
 */
import type {
  ContestConfigurationRepository,
  ContestEntryPickRepository,
  ContestEntryRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type { GolfLeaderboardParticipantRow } from '../../mappers/contests.mapper';
import type { SportEventParticipantService } from '../events/sport-event-participant-service';
import {
  buildGolfRoundColumns,
  mapGolfLeaderboardStatus,
  type GolfContestConfigurationRow,
  type GolfLeaderboardEntryInput,
} from './golf-leaderboard-calculator';

export interface GolfContestReadDeps {
  eventParticipants: Pick<SportEventParticipantService, 'listEventParticipants'>;
  configurations: ContestConfigurationRepository;
  scoringRules: ParticipantContestScoringRuleRepository;
  entries: ContestEntryRepository;
  picks: ContestEntryPickRepository;
}

/** The event's field in seed order, one golf row per golfer. */
export async function loadGolfLeaderboardParticipants(
  deps: Pick<GolfContestReadDeps, 'eventParticipants'>,
  sportEventId: string,
): Promise<GolfLeaderboardParticipantRow[]> {
  const field = await deps.eventParticipants.listEventParticipants(sportEventId);
  return field.map(({ entry, participant, standing, rounds }) => {
    const golfStanding = standing?.golf ?? null;
    const status = standing ? mapGolfLeaderboardStatus(String(standing.standing.status)) : 'active';
    return {
      sportEventParticipantId: entry.id,
      participantId: entry.participantId,
      name: participant.name,
      shortName: participant.shortName ?? null,
      isActive: entry.isActive,
      inactiveReason: entry.inactiveReason ?? null,
      ranking: entry.ranking ?? null,
      oddsToWin: entry.oddsToWin ?? null,
      seedNumber: entry.seedNumber ?? null,
      totalScoreToPar: golfStanding?.eventScoreToPar ?? null,
      totalStrokes: golfStanding?.eventStrokes ?? null,
      thru: status === 'in-progress' ? golfStanding?.currentRoundThru ?? null : null,
      currentRound: standing?.standing.currentRound ?? null,
      status,
      position: standing?.standing.position ?? null,
      displayPosition: standing?.standing.displayPosition ?? null,
      asOf: standing?.standing.asOf ?? null,
      rounds: buildGolfRoundColumns(
        rounds.flatMap(({ round, golf }) => (golf
          ? [{ strokes: golf.strokes, scoreToPar: golf.scoreToPar, thru: golf.thru, status: round.status, round: round.roundNumber }]
          : [])),
      ),
    };
  });
}

/** The contest's counting and scoring configuration, or null when it has none. */
export async function loadGolfContestConfiguration(
  deps: Pick<GolfContestReadDeps, 'configurations' | 'scoringRules'>,
  contestId: string,
): Promise<GolfContestConfigurationRow | null> {
  const configuration = await deps.configurations.findByContest(contestId);
  if (!configuration) {
    return null;
  }
  const rules = await deps.scoringRules.findByContestConfiguration(configuration.id);
  return {
    configJson: configuration.configJson ?? null,
    rosterSize: configuration.rosterSize ?? null,
    pickCount: configuration.pickCount ?? null,
    rounds: configuration.rounds ?? null,
    participantScoringRules: rules.map((rule) => ({
      participantScoringDefinitionId: rule.participantScoringDefinitionId,
      sortOrder: rule.sortOrder,
      active: rule.active,
    })),
  };
}

/** The contest's ACTIVE entries in entry order, each with its picks in pick order. */
export async function loadGolfLeaderboardEntries(
  deps: Pick<GolfContestReadDeps, 'entries' | 'picks'>,
  contestId: string,
): Promise<GolfLeaderboardEntryInput[]> {
  const entries = await deps.entries.findByContestWithSquad(contestId, { activeOnly: true });
  const picks = await deps.picks.findByEntries(entries.map((entry) => entry.id));
  const picksByEntry = new Map<string, GolfLeaderboardEntryInput['picks']>();
  for (const pick of picks) {
    const list = picksByEntry.get(pick.entryId) ?? [];
    list.push({
      id: pick.id,
      sportEventParticipantId: pick.sportEventParticipantId,
      pickedAt: pick.pickedAt,
      slot: pick.slot ?? null,
      tier: pick.tier ?? null,
    });
    picksByEntry.set(pick.entryId, list);
  }
  return entries.map((entry) => ({
    id: entry.id,
    entryNumber: entry.entryNumber,
    name: entry.name,
    status: entry.status,
    squadId: entry.squadId,
    squad: { name: entry.squadName },
    picks: picksByEntry.get(entry.id) ?? [],
  }));
}
