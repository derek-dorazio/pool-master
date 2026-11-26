/**
 * The event reads contest creation and opening make, over the event repositories: contest
 * creation's reader, and the opening reader's batched form of it (#1316). `wiring.ts` builds both
 * on Prisma.
 */
import type {
  SportEventRoundMatchRepository,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventRepository,
  SportRepository,
} from '@poolmaster/shared/db';
import { MatchStatus, SportEventParticipantStatus, getDefaultTournamentFormatForSport, isSquaresRound, hasSportEventStarted, matchSpread } from '@poolmaster/shared/domain';
import { contestBracketGames, findBracketProblem } from '../scoring-families/head-to-head/bracket-picks';
import { ContestCutoffKind, cutoffTiming } from '../contests/entry-window';
import { knockoutSeeds } from '../scoring-families/head-to-head/score-team';
import { BatchedRead, batchedByIds, batchedByKey, withReads } from '../../core/batched-read';
import type { ContestOpeningReader } from './contest-opening';
import type { ContestCreateSportEventReader, ContestCreateSportEventState } from './service';

/**
 * What contest creation and opening need to know about the event: its status and start time,
 * its release and field-lock timing, its sport league (for a league's own template), its sport's tournament format, how much of its field has
 * loaded, and for budget rules its salary cap and its active golfers' prices (#93). Composed
 * from the slice-2 ports (#247) — it was a raw Prisma read inlined here.
 */
export function createContestSportEventReader({ sportEvents, sports, field, valuations, matches }: {
  sportEvents: SportEventRepository;
  sports: SportRepository;
  field: SportEventParticipantRepository;
  valuations: SportEventParticipantValuationRepository;
  matches: SportEventRoundMatchRepository;
}): ContestCreateSportEventReader {
  /**
   * The events' states from one read each of the events, their sports and their loaded field
   * counts, however many events (#1355): a contest's events are all asked about at once.
   */
  const findByIds = async (sportEventIds: readonly string[]): Promise<ContestCreateSportEventState[]> => {
    const events = await sportEvents.findByIds(sportEventIds);
    if (events.length === 0) {
      return [];
    }
    // The sport rows are a fixed handful, so all of them are one read whatever sports the events have.
    const [sportRows, loaded] = await Promise.all([
      sports.findAll(),
      sportEvents.countParticipants(events.map((event) => event.id)),
    ]);
    const sportByKind = new Map(sportRows.map((row) => [row.sport, row]));
    return events.map((event) => ({
      id: event.id,
      status: event.status,
      startDate: event.startDate,
      sport: event.sport,
      sportLeagueId: event.sportLeagueId,
      championshipYear: event.championshipYear,
      tournamentFormat: sportByKind.get(event.sport)?.tournamentFormat ?? getDefaultTournamentFormatForSport(event.sport),
      participantCount: loaded.get(event.id) ?? 0,
      rounds: event.rounds ?? null,
      salaryCap: event.pricingConfig?.salaryCap ?? null,
      squaresFromRound: event.squaresFromRound ?? null,
      participantType: event.participantType,
      scoringFamily: event.scoringFamily,
    }));
  };
  return {
    findById: async (sportEventId) => (await findByIds([sportEventId])).at(0) ?? null,
    findByIds,
    findActiveFieldPrices: async (sportEventId) => {
      const [entries, eventValuations] = await Promise.all([
        field.findBySportEvent(sportEventId),
        valuations.findBySportEvent(sportEventId),
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
      return findBracketProblem(contestBracketGames(games), knockoutSeeds(entries));
    },
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
export function createBatchedContestOpeningReader({ sportEvents, sports, field, valuations, matches: eventMatches }: {
  sportEvents: SportEventRepository;
  sports: SportRepository;
  field: SportEventParticipantRepository;
  valuations: SportEventParticipantValuationRepository;
  matches: SportEventRoundMatchRepository;
}): ContestOpeningReader {
  const eventsById = batchedByIds((ids) => sportEvents.findByIds(ids), (event) => event.id);
  const participantCounts = new BatchedRead<string, number>(async (sportEventIds) => {
    const counts = await sportEvents.countParticipants([...new Set(sportEventIds)]);
    return sportEventIds.map((sportEventId) => counts.get(sportEventId) ?? 0);
  });
  // The sport rows are a fixed list of a handful: the first ask reads them all, for the whole page.
  let sportRows: ReturnType<typeof sports.findAll> | undefined;
  const gamesOf = batchedByKey((sportEventIds) => eventMatches.findBySportEvents(sportEventIds), (game) => game.sportEventId);
  const fieldOf = batchedByKey((sportEventIds) => field.findBySportEvents(sportEventIds), (row) => row.sportEventId);
  const matches = withReads(eventMatches, { findBySportEvent: (sportEventId) => gamesOf.load(sportEventId) });
  const reader = createContestSportEventReader({
    sportEvents: withReads(sportEvents, {
      findByIds: (ids) => eventsById.load(ids),
      countParticipants: async (sportEventIds) => new Map(await Promise.all(sportEventIds.map(async (sportEventId) => [sportEventId, await participantCounts.load(sportEventId)] as const))),
    }),
    sports: withReads(sports, { findAll: () => (sportRows ??= sports.findAll()) }),
    field: withReads(field, { findBySportEvent: (sportEventId) => fieldOf.load(sportEventId) }),
    valuations,
    matches,
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
