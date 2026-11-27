/**
 * The event reads contest creation and opening make, over the event repositories: contest
 * creation's reader, and the opening reader's batched form of it (#1316). `wiring.ts` builds both
 * on Prisma.
 */
import type {
  SportEventRoundMatchRepository,
  SportEventRoundRepository,
  SportEventParticipantRepository,
  SportEventSlotParticipantValuationRepository,
  SportEventSlotTierRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import { tierSetSlotOf, type SportEventTierSlot, MatchStatus, SportEventParticipantStatus, coveredRoundNumbers, eventPlaysMatches, playsKnockoutRounds, isSquaresRound, hasSportEventStarted, matchSpread } from '@poolmaster/shared/domain';
import { findBracketProblem, findKnockoutProblem, knockoutGames } from '../scoring-families/head-to-head/bracket-picks';
import { ContestCutoffKind, cutoffTiming } from '../contests/entry-window';
import { knockoutSeeds } from '../scoring-families/head-to-head/score-team';
import { BatchedRead, batchedByIds, batchedByKey, withReads } from '../../core/batched-read';
import type { ContestOpeningReader } from './contest-opening';
import type { ContestCreateSportEventReader, ContestCreateSportEventState } from './service';

/**
 * What contest creation and opening need to know about the event: its status and start time,
 * its release and field-lock timing, its sport league (for a league's own template), whether it plays matches, how much of its field has
 * loaded, and for budget rules its salary cap and its active golfers' prices (#93), both its first
 * slot's set's (#2044). Composed
 * from the slice-2 ports (#247) — it was a raw Prisma read inlined here.
 */
export function createContestSportEventReader({ sportEvents, field, tiers, valuations, matches, rounds }: {
  sportEvents: SportEventRepository;
  field: SportEventParticipantRepository;
  tiers: Pick<SportEventSlotTierRepository, 'findTierSlots'>;
  valuations: Pick<SportEventSlotParticipantValuationRepository, 'findBySlot'>;
  matches: SportEventRoundMatchRepository;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvent'>;
}): ContestCreateSportEventReader {
  /**
   * The events' states from one read each of the events and their loaded field
   * counts, however many events (#1355): a contest's events are all asked about at once.
   */
  const findByIds = async (sportEventIds: readonly string[]): Promise<ContestCreateSportEventState[]> => {
    const events = await sportEvents.findByIds(sportEventIds);
    if (events.length === 0) {
      return [];
    }
    const [loaded, tierSlots] = await Promise.all([
      sportEvents.countParticipants(events.map((event) => event.id)),
      tiers.findTierSlots(events.map((event) => event.id)),
    ]);
    return events.map((event) => ({
      id: event.id,
      status: event.status,
      startDate: event.startDate,
      sport: event.sport,
      sportLeagueId: event.sportLeagueId,
      championshipYear: event.championshipYear,
      playsMatches: eventPlaysMatches(event),
      participantCount: loaded.get(event.id) ?? 0,
      rounds: event.rounds ?? null,
      slotDefinitionIds: event.slotDefinitions.map((definition) => definition.id),
      playsOnlyKnockoutRounds: event.slotDefinitions.every((definition) => playsKnockoutRounds(definition.slotKind)),
      salaryCap: tierSetSlotOf(tierSlots.get(event.id) ?? [])?.pricing?.salaryCap ?? null,
      squaresFromRound: event.squaresFromRound ?? null,
      participantType: event.participantType,
      scoringFamily: event.scoringFamily,
    }));
  };
  return {
    findById: async (sportEventId) => (await findByIds([sportEventId])).at(0) ?? null,
    findByIds,
    findActiveFieldPrices: async (sportEventId) => {
      const firstSlot = tierSetSlotOf((await tiers.findTierSlots([sportEventId])).get(sportEventId) ?? []);
      if (firstSlot === undefined) return [];
      const [entries, eventValuations] = await Promise.all([
        field.findBySportEvent(sportEventId),
        valuations.findBySlot(firstSlot.id),
      ]);
      const activeEntryIds = new Set(entries.filter((entry) => entry.status === SportEventParticipantStatus.ACTIVE).map((entry) => entry.id));
      return eventValuations.flatMap((valuation) =>
        activeEntryIds.has(valuation.sportEventParticipantId) && valuation.price !== null ? [valuation.price] : []);
    },
    countGames: async (sportEventId) =>
      (await matches.findBySportEvent(sportEventId)).filter((match) => match.status !== MatchStatus.CANCELLED).length,
    countUndecidedGames: async (sportEventId, options) => {
      const games = (await matches.findBySportEvent(sportEventId)).filter((match) => match.status !== MatchStatus.CANCELLED);
      const openingRound = Math.min(...games.map((match) => match.roundNumber));
      return games.filter((match) => (options?.openingRoundOnly !== true || match.roundNumber === openingRound)
        && match.sides.some((side) => side.sportEventParticipantId === null)).length;
    },
    countGamesWithoutSpread: async (sportEventId) =>
      (await matches.findBySportEvent(sportEventId)).filter((match) => match.status !== MatchStatus.CANCELLED && matchSpread(match) === null).length,
    findBracketProblem: async (sportEventId) => {
      const [games, entries] = await Promise.all([matches.findBySportEvent(sportEventId), field.findBySportEvent(sportEventId)]);
      // The event's own bracket, every knockout round of it: whether its games form one is the
      // event's fact, whichever rounds a contest on it covers. Its group matchdays and third-place
      // play-off are no round of it (#2241).
      return findBracketProblem(knockoutGames(games.filter((match) => match.status !== MatchStatus.CANCELLED)), knockoutSeeds(entries));
    },
    findKnockoutProblem: async (sportEventId) => {
      const [games, entries] = await Promise.all([matches.findBySportEvent(sportEventId), field.findBySportEvent(sportEventId)]);
      const played = games.filter((match) => match.status !== MatchStatus.CANCELLED);
      // An event with a knockout game plays a knockout round, so only one without reads its rounds
      // (#2241): whether it plays none, or its knockout games are not placed yet.
      const eventRounds = knockoutGames(played).length > 0 ? played : await rounds.findBySportEvent(sportEventId);
      return findKnockoutProblem(played, knockoutSeeds(entries), eventRounds);
    },
    // Counted from the event's rounds and their slots, not its games (#2241): slots govern rounds,
    // so a tournament's knockout rounds are known before any knockout game is placed.
    countCoveredRounds: async (sportEventId, coverage) =>
      coveredRoundNumbers(coverage, await rounds.findBySportEvent(sportEventId)).length,
    findGame: async (sportEventId, sportEventRoundMatchId) => {
      const game = (await matches.findBySportEvent(sportEventId)).find((match) => match.id === sportEventRoundMatchId);
      return game === undefined ? null : { status: game.status, roundNumber: game.roundNumber };
    },
    findCutoffTiming: async (sportEvent, cutoff) => cutoff.kind === ContestCutoffKind.EVENT_START
      ? sportEvent
      : cutoffTiming(cutoff, sportEvent, await matches.findBySportEvent(sportEvent.id)),
  };
}

/** The opening reader over its repositories, with the batching described on `createContestOpeningReader`. */
export function createBatchedContestOpeningReader({ sportEvents, field, tiers, valuations, matches: eventMatches, rounds }: {
  sportEvents: SportEventRepository;
  field: SportEventParticipantRepository;
  tiers: Pick<SportEventSlotTierRepository, 'findTierSlots'>;
  valuations: Pick<SportEventSlotParticipantValuationRepository, 'findBySlot'>;
  matches: SportEventRoundMatchRepository;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvent'>;
}): ContestOpeningReader {
  const eventsById = batchedByIds((ids) => sportEvents.findByIds(ids), (event) => event.id);
  const participantCounts = new BatchedRead<string, number>(async (sportEventIds) => {
    const counts = await sportEvents.countParticipants([...new Set(sportEventIds)]);
    return sportEventIds.map((sportEventId) => counts.get(sportEventId) ?? 0);
  });
  const gamesOf = batchedByKey((sportEventIds) => eventMatches.findBySportEvents(sportEventIds), (game) => game.sportEventId);
  const fieldOf = batchedByKey((sportEventIds) => field.findBySportEvents(sportEventIds), (row) => row.sportEventId);
  const matches = withReads(eventMatches, { findBySportEvent: (sportEventId) => gamesOf.load(sportEventId) });
  // Every event's tier slots in one read, for the salary caps (#2044).
  const tierSlotsOf = new BatchedRead<string, SportEventTierSlot[]>(async (sportEventIds) => {
    const slots = await tiers.findTierSlots([...new Set(sportEventIds)]);
    return sportEventIds.map((sportEventId) => slots.get(sportEventId) ?? []);
  });
  const reader = createContestSportEventReader({
    sportEvents: withReads(sportEvents, {
      findByIds: (ids) => eventsById.load(ids),
      countParticipants: async (sportEventIds) => new Map(await Promise.all(sportEventIds.map(async (sportEventId) => [sportEventId, await participantCounts.load(sportEventId)] as const))),
    }),
    field: withReads(field, { findBySportEvent: (sportEventId) => fieldOf.load(sportEventId) }),
    tiers: {
      findTierSlots: async (sportEventIds) => new Map(await Promise.all(sportEventIds.map(async (sportEventId) => [sportEventId, await tierSlotsOf.load(sportEventId)] as const))),
    },
    valuations,
    matches,
    rounds,
  });
  return {
    ...reader,
    nextSquaresKickoff: async (sportEvent, now) => {
      const games = await matches.findBySportEvent(sportEvent.id);
      const kickoffs = games
        .filter((game) => game.status !== MatchStatus.CANCELLED && isSquaresRound(sportEvent.squaresFromRound, game.roundNumber))
        .map((game) => cutoffTiming({ kind: ContestCutoffKind.MATCH_START, sportEventRoundMatchId: game.id }, sportEvent, games))
        .filter((timing) => !hasSportEventStarted(timing, now))
        .map((timing) => timing.startDate.getTime());
      return kickoffs.length === 0 ? null : new Date(Math.min(...kickoffs));
    },
  };
}
