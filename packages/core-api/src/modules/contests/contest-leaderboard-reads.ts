/**
 * What the contest leaderboard and golf settlement both read, on ports (#247): the event's field,
 * the contest's counting and scoring configuration, and its active entries with their picks. One
 * set of reads for both, so the live leaderboard and the settled result cannot drift apart.
 */
import type {
  ContestConfigurationRepository,
  ContestEntryPickRepository,
  ContestEntryRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type {
  SportEventParticipantService,
  SportEventParticipantView,
} from '../events/sport-event-participant-service';
import type {
  ContestLeaderboardEntryInput,
  ContestScoringConfigurationRow,
  ParticipantScore,
} from './contest-leaderboard-calculator';

export interface ContestLeaderboardReadDeps {
  eventParticipants: Pick<SportEventParticipantService, 'listEventParticipants'>;
  configurations: ContestConfigurationRepository;
  scoringRules: ParticipantContestScoringRuleRepository;
  entries: ContestEntryRepository;
  picks: ContestEntryPickRepository;
}

/** The event's field, in seed order, as the event publishes it. */
export async function loadEventField(
  deps: Pick<ContestLeaderboardReadDeps, 'eventParticipants'>,
  sportEventId: string,
): Promise<SportEventParticipantView[]> {
  return deps.eventParticipants.listEventParticipants(sportEventId);
}

/**
 * Each field row's score under the contest's scoring definition. The one definition today,
 * GOLF_RELATIVE_TO_PAR_TOTAL, scores a golfer by their event total against par, which lives on
 * the standing's golf extension; a row with no scored standing is unscored.
 */
export function toParticipantScores(field: readonly SportEventParticipantView[]): ParticipantScore[] {
  return field.map(({ entry, participant, standing }) => ({
    sportEventParticipantId: entry.id,
    name: participant.name,
    score: standing?.golf?.eventScoreToPar ?? null,
    asOf: standing?.standing.asOf ?? null,
  }));
}

/** The contest's counting and scoring configuration, or null when it has none. */
export async function loadContestScoringConfiguration(
  deps: Pick<ContestLeaderboardReadDeps, 'configurations' | 'scoringRules'>,
  contestId: string,
): Promise<ContestScoringConfigurationRow | null> {
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
export async function loadContestLeaderboardEntries(
  deps: Pick<ContestLeaderboardReadDeps, 'entries' | 'picks'>,
  contestId: string,
): Promise<ContestLeaderboardEntryInput[]> {
  const entries = await deps.entries.findByContestWithSquad(contestId, { activeOnly: true });
  const picks = await deps.picks.findByEntries(entries.map((entry) => entry.id));
  const picksByEntry = new Map<string, ContestLeaderboardEntryInput['picks']>();
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
