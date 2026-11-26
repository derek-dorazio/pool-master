/**
 * SportEventBracketService — an event's bracket (#698, plans/knockout-and-pickem-design.md §2):
 * its matches, round by round, and where each winner moves on to. Only an event whose sport plays
 * a bracket has one (422 SPORT_EVENT_NOT_BRACKET otherwise).
 *
 * The admin loads the whole bracket at once and edits one match at a time. Pairings are the
 * admin's until the event is released; after that a match's time and site can still move, and
 * its sides are filled by results (#699). Loading checks the bracket's shape; release checks
 * that it is complete (`releaseBlockers`), so a bracket can be loaded before its field is.
 *
 * An event whose slots are paired by reseeding (SlotPairing.RESEEDED, the NFL) leaves the
 * matches of a round before a reseed without links. Once every game of that round is final the
 * admin places the next round's teams region by region (`setRoundMatchups`), from the pairing the
 * server proposes from seeds (`proposeRoundMatchups`, bracket-reseed.ts).
 *
 * A play-in (the March Madness First Four) is a round of its own: each play-in match advances its
 * winner into an empty side of the next round, like any linked match (#2184).
 */

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryMatchPredictionRepository,
  ContestRepository,
  MatchSideWrite,
  SportEventRoundMatchPatch,
  SportEventRoundMatchRepository,
  SportEventRoundMatchWrite,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventRepository,
  SportEventRoundRepository,
  SportEventTierRepository,
} from '@poolmaster/shared/db';
import {
  eventPlaysMatches,
  eventSportDefinition,
  getSportDefinition,
  describeMatchPlace,
  isAtPlace,
  type MatchPlace,
  MatchPlaceMap,
  matchPlaceOf,
  HomeAway,
  matchSpread,
  sideOfParticipant,
  sideParticipantId,
  finalRoundNumbers,
  SlotPairing,
  type SportEvent,
  type SportEventRound,
  type SportEventRoundMatch,
  SportEventStatus,
  sportVocabulary,
  SportEventParticipantStatus,
} from '@poolmaster/shared/domain';
import { roundLabels } from '@poolmaster/shared/display-strings';
import { SportEventError } from './errors';
import { combineJobsForWrite, type JobsForWrite } from '../background-jobs/background-job-queue';
import { DomainEventType, type DomainEvents } from '../domain-events';
import { findReseededPlaceGaps, findRoundMatchupProblems, proposeRoundMatchups, reseededRounds, roundPlacementBlocker, type RoundMatchup } from './bracket-reseed';

/** Where a match's winner moves on to: the next match, by round and number, and the side it fills there. */
export interface BracketAdvance extends MatchPlace {
  sideNumber: number;
}

/** One side of a match being loaded: its team, or null while it is not known, and where it plays Game 1. */
export interface BracketSideInput {
  sideNumber: number;
  sportEventParticipantId: string | null;
  homeAway: HomeAway;
}

/** One match of a bracket as the admin loads it, numbered within its round (#2161). */
export interface BracketMatchInput extends MatchPlace {
  /** Side 1 and side 2 (#2184). */
  sides: readonly BracketSideInput[];
  isNeutralSite: boolean;
  scheduledDate: Date | null;
  /** Null for the final, the one match whose winner goes nowhere; in a reseeded bracket, also a match before a reseed. */
  advancesTo: BracketAdvance | null;
  /** The bracket region or conference; omitted or null where the bracket has none. */
  regionLabel?: string | null;
}

/** One match edit; a value left out keeps what is stored. */
export interface BracketMatchEdit {
  /** Teams by side number; a side left out keeps its team. */
  sides?: readonly { sideNumber: number; sportEventParticipantId: string | null }[];
  isNeutralSite?: boolean;
  scheduledDate?: Date | null;
  /** The spread on side 1. */
  spread?: number | null;
  /** Where each side plays Game 1, by side number: the sync's only change to an existing match's sides. */
  gameOneHomeAway?: readonly { sideNumber: number; homeAway: HomeAway }[];
}

/** The side numbers every match has. */
const SIDE_NUMBERS = [1, 2] as const;

/** A match being loaded's team on a side, or null. */
function inputSideOf(match: Pick<BracketMatchInput, 'sides'>, sideNumber: number): string | null {
  return match.sides.find((side) => side.sideNumber === sideNumber)?.sportEventParticipantId ?? null;
}

/** Whether a link fills side `sideNumber` of `matchId`. */
function isFedSide(bracket: readonly SportEventRoundMatch[], matchId: string, sideNumber: number): boolean {
  return bracket.some((other) => other.advancesToMatchId === matchId && other.advancesToSideNumber === sideNumber);
}

/** A match being created, on its sides (#2046), in side-number order. */
function sidesOfInput(match: Pick<BracketMatchInput, 'sides'>): MatchSideWrite[] {
  return match.sides.map(({ sideNumber, sportEventParticipantId, homeAway }) => ({ sideNumber, sportEventParticipantId, homeAway }))
    .sort((left, right) => left.sideNumber - right.sideNumber);
}

/** An edit, as the stored match's patch by side. */
function toPatch({ sides, ...edit }: BracketMatchEdit): SportEventRoundMatchPatch {
  return { ...edit, ...(sides !== undefined && sides.length > 0 && { sides }) };
}

/** "round 2 match 1 side 2": a side of a match, as the problems name it. */
function describeSide(place: MatchPlace, sideNumber: number): string {
  return `${describeMatchPlace(place)} side ${String(sideNumber)}`;
}

/** Whether a match's sides say where each plays Game 1 as its site does: both NONE at a neutral site, else one HOME and one AWAY. */
function homeAwayFitsSite(match: Pick<BracketMatchInput, 'sides' | 'isNeutralSite'>): boolean {
  const homeAways = match.sides.map((side) => side.homeAway).sort();
  return match.isNeutralSite
    ? homeAways.every((homeAway) => homeAway === HomeAway.NONE)
    : homeAways.join() === [HomeAway.AWAY, HomeAway.HOME].join();
}

/**
 * Whether the games are a set of games rather than a bracket (an NFL regular-season week, #715):
 * one round, none linking anywhere. Unlinked games over several rounds are still a (reseeded)
 * bracket. `links` says whether a game sends its winner on, for a loaded match or one being loaded.
 */
export function formsNoBracket<M extends { roundNumber: number }>(matches: readonly M[], links: (match: M) => boolean): boolean {
  // poolmaster-allow-position: any one match: every match must share its round number
  return matches.every((match) => !links(match) && match.roundNumber === matches[0]?.roundNumber);
}

/**
 * Everything wrong with a bracket's shape, in words an admin can act on; empty when it can be
 * loaded. A side may be empty here (its team is not known yet), but never both named and filled
 * by an earlier match's winner. A bracket that `reseeds` may leave a match before its last round
 * without a link: its winner is placed when the next round is reseeded. Games of one round none of
 * which link anywhere are a set of games rather than a bracket (a week of NFL games), and have no
 * final.
 */
export function findBracketProblems(
  matches: readonly BracketMatchInput[],
  context: {
    roundNumbers: ReadonlySet<number>;
    /**
     * The rounds played in the event's FINAL slot: the final's round. Null where the caller does
     * not know the event's slots (a test data file before it loads): the final and the unplaced
     * winners are then left to the check made when the bracket is loaded.
     */
    finalRoundNumbers: ReadonlySet<number> | null;
    fieldIds: ReadonlySet<string>;
    reseeds?: boolean;
  },
): string[] {
  const problems: string[] = [];
  const byPlace = new MatchPlaceMap<BracketMatchInput>();
  for (const match of matches) {
    if (byPlace.has(match)) {
      problems.push(`${describeMatchPlace(match)} is used more than once`);
    }
    byPlace.set(match, match);
  }

  const sideOwner = new Map<string, string>();
  const fedSides = new Set<string>();
  for (const match of matches) {
    if (!context.roundNumbers.has(match.roundNumber)) {
      problems.push(`${describeMatchPlace(match)} is in a round the event does not have`);
    }
    if (!homeAwayFitsSite(match)) {
      problems.push(`${describeMatchPlace(match)} ${match.isNeutralSite ? 'is at a neutral site, so neither side is home or away' : 'needs one home side and one away side'}`);
    }
    for (const sideNumber of SIDE_NUMBERS) {
      const sportEventParticipantId = inputSideOf(match, sideNumber);
      if (sportEventParticipantId === null) continue;
      if (!context.fieldIds.has(sportEventParticipantId)) {
        problems.push(`${describeSide(match, sideNumber)} names ${sportEventParticipantId}, which is not on the event's field`);
        continue;
      }
      const owner = sideOwner.get(sportEventParticipantId);
      if (owner !== undefined) {
        problems.push(`${describeSide(match, sideNumber)} names the same field row as ${owner}`);
      } else {
        sideOwner.set(sportEventParticipantId, describeSide(match, sideNumber));
      }
    }

    const { advancesTo } = match;
    if (advancesTo === null) continue;
    const next = byPlace.get(advancesTo);
    if (!next) {
      problems.push(`${describeMatchPlace(match)} advances to ${describeMatchPlace(advancesTo)}, which the bracket does not have`);
      continue;
    }
    if (next.roundNumber <= match.roundNumber) {
      problems.push(`${describeMatchPlace(match)} advances to ${describeMatchPlace(advancesTo)}, which is not in a later round`);
    }
    const fed = describeSide(advancesTo, advancesTo.sideNumber);
    if (fedSides.has(fed)) {
      problems.push(`two matches advance to ${fed}`);
    }
    fedSides.add(fed);
    if (inputSideOf(next, advancesTo.sideNumber) !== null) {
      problems.push(`${fed} names a team, but ${describeMatchPlace(match)}'s winner fills it`);
    }
  }

  // A set of games has no final to find.
  const { finalRoundNumbers } = context;
  if (finalRoundNumbers === null || formsNoBracket(matches, (match) => match.advancesTo !== null)) {
    return problems;
  }
  // The final is the match of the FINAL slot's round (#2006), never the last round's.
  const unlinked = matches.filter((match) => match.advancesTo === null);
  const finals = unlinked.filter((match) => finalRoundNumbers.has(match.roundNumber));
  if (finals.length !== 1) {
    problems.push(`a bracket has one final, the one match of its FINAL slot's round, but this one has ${finals.length}`);
  }
  // Outside the final's round, only a reseeded bracket leaves a winner unplaced: the next round's reseed places it.
  if (context.reseeds !== true) {
    for (const match of unlinked.filter((each) => !finalRoundNumbers.has(each.roundNumber))) {
      problems.push(`${describeMatchPlace(match)}'s winner advances nowhere, but it is not the final`);
    }
  }
  return problems;
}

export interface SportEventBracketServiceDeps {
  sportEvents: Pick<SportEventRepository, 'findById'>;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvent'>;
  field: SportEventParticipantRepository;
  matches: SportEventRoundMatchRepository;
  /** The event's tiers and valuations, which a replacement joins at the bottom of. */
  tiers: Pick<SportEventTierRepository, 'findBySportEvent'>;
  valuations: Pick<SportEventParticipantValuationRepository, 'findBySportEvent'>;
  /** Whether a game has picks: a released game's spread is fixed once it has (#720). */
  predictions: Pick<ContestEntryMatchPredictionRepository, 'hasAnyOnMatch'>;
  /** A game's new time can move its contests' entry reminders (#1170). */
  contests: Pick<ContestRepository, 'recheckReminders'>;
  /** What follows each results, field or game change it writes (#1946): the app's one map. */
  domainEvents: Pick<DomainEvents, 'collect'>;
  newId?: () => string;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export class SportEventBracketService {
  constructor(private readonly deps: SportEventBracketServiceDeps) {}

  /** The bracket in round order, then match-number order; empty until it is loaded. */
  async listBracket(sportEventId: string): Promise<SportEventRoundMatch[]> {
    await this.requireBracketEvent(sportEventId);
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /**
   * Replaces the event's bracket with `matches`, all or none. 409 SPORT_EVENT_BRACKET_LOCKED once
   * the event is released; 422 BRACKET_INVALID with every problem found when its shape is wrong.
   */
  async loadBracket(sportEventId: string, matches: readonly BracketMatchInput[]): Promise<SportEventRoundMatch[]> {
    const event = await this.requireBracketEvent(sportEventId);
    this.assertPairingsEditable(event);
    const [rounds, field] = await Promise.all([
      this.deps.rounds.findBySportEvent(sportEventId),
      this.deps.field.findBySportEvent(sportEventId),
    ]);
    const problems = findBracketProblems(matches, {
      roundNumbers: new Set(rounds.map((round) => round.roundNumber)),
      finalRoundNumbers: finalRoundsOfInput(matches, rounds),
      fieldIds: new Set(field.map((entry) => entry.id)),
      reseeds: reseedsOf(rounds),
    });
    if (problems.length > 0) {
      this.deps.logger?.warn({ sportEventId, matches: matches.length, problems }, 'Refused a bracket with problems');
      throw new SportEventError(`The bracket cannot be loaded: ${problems.join('; ')}.`, 'BRACKET_INVALID', 422);
    }

    const newId = this.deps.newId ?? randomUUID;
    const idByPlace = new MatchPlaceMap(matches.map((match) => [match, newId()] as const));
    const writes: SportEventRoundMatchWrite[] = matches.map((match) => ({
      id: idByPlace.get(match) as string,
      roundNumber: match.roundNumber,
      matchNumber: match.matchNumber,
      sides: sidesOfInput(match),
      isNeutralSite: match.isNeutralSite,
      scheduledDate: match.scheduledDate,
      regionLabel: match.regionLabel ?? null,
      advancesToMatchId: match.advancesTo ? idByPlace.get(match.advancesTo) as string : null,
      advancesToSideNumber: match.advancesTo ? match.advancesTo.sideNumber : null,
    }));
    const rebuild = await this.gamesWrite(sportEventId);
    await this.deps.matches.replaceBracket(sportEventId, writes, rebuild.jobs);
    rebuild.queued();
    this.deps.logger?.info({ sportEventId, matches: writes.length }, 'Loaded bracket');
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /**
   * Edits one match. Its time and site can change at any point; its sides only until release
   * (409 SPORT_EVENT_BRACKET_LOCKED). A side an earlier match's winner fills, a side naming a
   * field row the bracket already has, or both sides naming one team is 422 BRACKET_INVALID.
   * Its spread (#720) can change until release, and after it only while no entry has picked the
   * game (409 MATCH_SPREAD_LOCKED), and never back to none (422 MATCH_SPREAD_REQUIRED).
   */
  async updateMatch(sportEventId: string, place: MatchPlace, edit: BracketMatchEdit): Promise<SportEventRoundMatch> {
    const event = await this.requireBracketEvent(sportEventId);
    const bracket = await this.deps.matches.findBySportEvent(sportEventId);
    const match = bracket.find((candidate) => isAtPlace(candidate, place));
    if (!match) {
      throw new SportEventError(`Sport event ${sportEventId} has no ${describeMatchPlace(place)}.`, 'BRACKET_MATCH_NOT_FOUND', 404);
    }

    const changesSides = edit.sides !== undefined;
    if (changesSides) {
      this.assertPairingsEditable(event);
      const problems = await this.findSideEditProblems(match, bracket, edit);
      if (problems.length > 0) {
        this.deps.logger?.warn({ sportEventId, ...place, problems }, 'Refused a match edit with problems');
        throw new SportEventError(`${describeMatchPlace(place, { sentenceStart: true })} cannot be changed: ${problems.join('; ')}.`, 'BRACKET_INVALID', 422);
      }
    }
    const changesSpread = edit.spread !== undefined && edit.spread !== matchSpread(match);
    if (changesSpread && event.status !== SportEventStatus.DRAFT) {
      this.assertSpreadKept(event, match, edit.spread);
      await this.assertSpreadUnpicked(event, match);
    }
    const rebuild = await this.gamesWrite(sportEventId);
    await this.deps.matches.update(match.id, toPatch(edit), rebuild.jobs);
    rebuild.queued();
    // A squares grid closes at its game's start (#1170).
    if (edit.scheduledDate !== undefined && edit.scheduledDate?.getTime() !== match.scheduledDate?.getTime()) {
      await this.deps.contests.recheckReminders({ sportEventId }, this.deps.now?.() ?? new Date());
    }
    this.deps.logger?.info({ sportEventId, ...place, changesSides, changesSpread }, 'Updated bracket match');
    const updated = (await this.deps.matches.findBySportEvent(sportEventId)).find((candidate) => candidate.id === match.id);
    return updated as SportEventRoundMatch;
  }

  /**
   * What still stops the event's release on its bracket's account (design Q3.6), in words an
   * admin can act on: every side of every match named or filled by an earlier winner, every
   * active field member in the bracket, and nobody withdrawn left in it. A reseeded round's empty
   * sides wait for the round before's winners, so in each of its regions there must be exactly one
   * per match of the round before that links nowhere (a bye team left out shows here). Empty for an
   * event whose sport plays no bracket.
   */
  async releaseBlockers(event: SportEvent): Promise<string[]> {
    if (!eventPlaysMatches(event)) {
      return [];
    }
    const [bracket, field] = await Promise.all([
      this.deps.matches.findBySportEvent(event.id),
      this.deps.field.findBySportEvent(event.id),
    ]);
    if (bracket.length === 0) {
      return ['its bracket is not loaded'];
    }
    // A reseeded round's teams are placed after the round before it is played.
    const rounds = await this.deps.rounds.findBySportEvent(event.id);
    const reseeds = reseedsOf(rounds);
    const placedLater = reseeds ? reseededRounds(bracket) : new Set<number>();
    const named = new Set<string>();
    let emptySides = 0;
    for (const match of bracket) {
      for (const { sideNumber, sportEventParticipantId } of match.sides) {
        if (sportEventParticipantId !== null) {
          named.add(sportEventParticipantId);
        } else if (!isFedSide(bracket, match.id, sideNumber) && !placedLater.has(match.roundNumber)) {
          emptySides += 1;
        }
      }
    }

    const { participant } = sportVocabulary(eventSportDefinition(event));
    const blockers: string[] = [];
    if (emptySides > 0) {
      blockers.push(`${emptySides} bracket place(s) have no ${participant.one} and no earlier match to fill them`);
    }
    if (reseeds) {
      const nameOfRound = roundLabels(rounds);
      for (const gap of findReseededPlaceGaps(bracket)) {
        const where = gap.regionLabel === null ? nameOfRound(gap.roundNumber) : `${nameOfRound(gap.roundNumber)} in ${gap.regionLabel}`;
        blockers.push(`${where} has ${gap.openPlaces} open place(s) for ${gap.winnersToCome} ${nameOfRound(gap.roundNumber - 1)} winner(s) still to come`);
      }
    }
    const missing = field.filter((entry) => entry.status === SportEventParticipantStatus.ACTIVE && !named.has(entry.id)).length;
    if (missing > 0) {
      blockers.push(`${missing} active ${participant.many} are not in the bracket`);
    }
    const withdrawn = field.filter((entry) => entry.status !== SportEventParticipantStatus.ACTIVE && named.has(entry.id)).length;
    if (withdrawn > 0) {
      blockers.push(`${withdrawn} withdrawn ${participant.many} are still in the bracket`);
    }
    return blockers;
  }

  /**
   * The reseeded pairing the server proposes for one round of a reseeded bracket (#722): in each
   * region the best seed left hosts the worst. 422 BRACKET_NOT_RESEEDED for a sport league whose
   * bracket does not reseed, or a round its links fill; 409 BRACKET_ROUND_NOT_FINISHED while the
   * round before has a match without a result; 409 BRACKET_ROUND_ALREADY_PLAYED once the round has
   * started; 422 BRACKET_INVALID when the teams left do not fit the round's places.
   */
  async proposeRoundMatchups(sportEventId: string, roundNumber: number): Promise<RoundMatchup[]> {
    const { bracket, seedOf } = await this.requireReseededRound(sportEventId, roundNumber);
    const { matchups, problems } = proposeRoundMatchups(bracket, roundNumber, seedOf);
    if (problems.length > 0) {
      this.deps.logger?.warn({ sportEventId, roundNumber, problems }, 'Could not propose a reseeded round');
      throw new SportEventError(`Round ${roundNumber} cannot be reseeded: ${problems.join('; ')}.`, 'BRACKET_INVALID', 422);
    }
    return matchups;
  }

  /**
   * Places a reseeded round's teams (#722): both sides of every match of the round, all or none.
   * The refusals of `proposeRoundMatchups`, and 422 BRACKET_INVALID when a match is set twice or
   * left out, a team is not one left in the round or plays twice, a team leaves its region, or a
   * team holding its place (a bye, a link's winner) is moved. It can be set again until the round
   * starts. Returns the bracket.
   */
  async setRoundMatchups(sportEventId: string, roundNumber: number, matchups: readonly RoundMatchup[]): Promise<SportEventRoundMatch[]> {
    const { bracket, seedOf } = await this.requireReseededRound(sportEventId, roundNumber);
    const problems = findRoundMatchupProblems(bracket, roundNumber, matchups, seedOf);
    if (problems.length > 0) {
      this.deps.logger?.warn({ sportEventId, roundNumber, problems }, 'Refused a reseeded round with problems');
      throw new SportEventError(`Round ${roundNumber} cannot be set: ${problems.join('; ')}.`, 'BRACKET_INVALID', 422);
    }
    // A reseeded round's matchups are numbered within the round.
    const idByNumber = new Map(bracket.filter((match) => match.roundNumber === roundNumber).map((match) => [match.matchNumber, match.id]));
    const rebuild = await this.gamesWrite(sportEventId);
    await this.deps.matches.placeSides(matchups.map((matchup) => ({
      id: idByNumber.get(matchup.matchNumber) as string,
      sides: matchup.sides,
    })), rebuild.jobs);
    rebuild.queued();
    this.deps.logger?.info({ sportEventId, roundNumber, matches: matchups.length }, 'Placed a reseeded round');
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /** The bracket and its seeds, for a released event's reseeded round that can be placed now. */
  private async requireReseededRound(sportEventId: string, roundNumber: number): Promise<{ bracket: SportEventRoundMatch[]; seedOf: Map<string, number | null> }> {
    const event = await this.requireBracketEvent(sportEventId);
    if (!(await this.reseeds(event))) {
      throw new SportEventError(`Sport event ${sportEventId}'s bracket does not reseed: each winner's next match is fixed by its link.`, 'BRACKET_NOT_RESEEDED', 422);
    }
    if (event.status === SportEventStatus.DRAFT) {
      throw new SportEventError(`Sport event ${sportEventId} is not released yet: set its pairings with the bracket.`, 'SPORT_EVENT_NOT_RELEASED', 409);
    }
    const [bracket, field] = await Promise.all([
      this.deps.matches.findBySportEvent(sportEventId),
      this.deps.field.findBySportEvent(sportEventId),
    ]);
    if (!reseededRounds(bracket).has(roundNumber)) {
      throw new SportEventError(`Round ${roundNumber} of sport event ${sportEventId} is not reseeded: its teams come from the links of the round before.`, 'BRACKET_NOT_RESEEDED', 422);
    }
    const blocker = roundPlacementBlocker(bracket, roundNumber);
    if (blocker) {
      this.deps.logger?.warn({ sportEventId, roundNumber, code: blocker.code }, 'Refused to place a reseeded round');
      throw new SportEventError(`Round ${roundNumber} cannot be placed: ${blocker.reason}.`, blocker.code, 409);
    }
    return { bracket, seedOf: new Map(field.map((entry) => [entry.id, entry.seedNumber ?? null])) };
  }

  /** Whether the event's bracket reseeds: its slots are paired by reseeding (#2006). */
  private async reseeds(event: SportEvent): Promise<boolean> {
    return reseedsOf(await this.deps.rounds.findBySportEvent(event.id));
  }

  private async findSideEditProblems(
    match: SportEventRoundMatch,
    bracket: readonly SportEventRoundMatch[],
    edit: BracketMatchEdit,
  ): Promise<string[]> {
    const field = new Set((await this.deps.field.findBySportEvent(match.sportEventId)).map((entry) => entry.id));
    const after = new Map(match.sides.map((side) => [side.sideNumber, side.sportEventParticipantId]));
    for (const side of edit.sides ?? []) after.set(side.sideNumber, side.sportEventParticipantId);
    const problems: string[] = [];
    const named = [...after.values()].filter((rowId) => rowId !== null);
    if (new Set(named).size < named.length) {
      problems.push('both sides name the same team');
    }
    for (const [sideNumber, sportEventParticipantId] of after) {
      if (sportEventParticipantId === null || sportEventParticipantId === sideParticipantId(match, sideNumber)) continue;
      if (!field.has(sportEventParticipantId)) {
        problems.push(`side ${String(sideNumber)} names ${sportEventParticipantId}, which is not on the event's field`);
        continue;
      }
      if (isFedSide(bracket, match.id, sideNumber)) {
        problems.push(`side ${String(sideNumber)} is filled by an earlier match's winner`);
      }
      const elsewhere = bracket.find((other) => other.id !== match.id && sideOfParticipant(other, sportEventParticipantId) !== null);
      if (elsewhere) {
        problems.push(`side ${String(sideNumber)} names a team already in ${describeMatchPlace(elsewhere)}`);
      }
    }
    return problems;
  }

  /**
   * A released game keeps a spread once it has one (#720): a pool against the spread checked every
   * spread when it took the week and never checks again, so a cleared spread would score every
   * pick on the game as a push. 422 MATCH_SPREAD_REQUIRED.
   */
  private assertSpreadKept(event: SportEvent, match: SportEventRoundMatch, spread: number | null | undefined): void {
    if (spread === null) {
      this.deps.logger?.warn({ sportEventId: event.id, ...matchPlaceOf(match) }, 'Refused clearing a released game\'s spread');
      throw new SportEventError(
        `${describeMatchPlace(match, { sentenceStart: true })} has been released, so its spread can be changed but not cleared.`,
        'MATCH_SPREAD_REQUIRED',
        422,
      );
    }
  }

  /**
   * A released game's spread is corrected only while nobody has picked the game (#720, design
   * Q5.9): a correction then changes no pick already made. 409 MATCH_SPREAD_LOCKED after that.
   */
  private async assertSpreadUnpicked(event: SportEvent, match: SportEventRoundMatch): Promise<void> {
    if (await this.deps.predictions.hasAnyOnMatch(match.id)) {
      this.deps.logger?.warn({ sportEventId: event.id, ...matchPlaceOf(match) }, 'Refused a spread change on a game that has picks');
      throw new SportEventError(
        `${describeMatchPlace(match, { sentenceStart: true })} already has picks, so its spread can no longer change.`,
        'MATCH_SPREAD_LOCKED',
        409,
      );
    }
  }

  /** Pairings are the admin's until release, as tiers and prices are. */
  private assertPairingsEditable(event: SportEvent): void {
    if (event.status !== SportEventStatus.DRAFT) {
      this.deps.logger?.warn({ sportEventId: event.id, status: event.status }, 'Refused a bracket change on a released sport event');
      throw new SportEventError(
        `Sport event ${event.id} has been released for contests, so its bracket's pairings are locked.`,
        'SPORT_EVENT_BRACKET_LOCKED',
        409,
      );
    }
  }

  /** The job rebuilding the event's boards, written with a bracket write that may change them (#1466, #1946). */
  private rebuild(sportEventId: string): Promise<JobsForWrite> {
    return this.deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId });
  }

  /**
   * What a write loading, timing or pairing the event's games carries: the boards' rebuild, and
   * what follows a change to its games (its slots' tiebreaker games, #2048).
   */
  private async gamesWrite(sportEventId: string): Promise<JobsForWrite> {
    return combineJobsForWrite(
      await this.rebuild(sportEventId),
      await this.deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_GAMES_CHANGED, sportEventId }),
    );
  }

  private async requireBracketEvent(sportEventId: string): Promise<SportEvent> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    if (!eventPlaysMatches(event)) {
      this.deps.logger?.warn({ sportEventId, sport: event.sport }, 'Refused a bracket operation on an event that plays no bracket');
      throw new SportEventError(
        `A ${getSportDefinition(event.sport).name.toLowerCase()} event is not played as a bracket.`,
        'SPORT_EVENT_NOT_BRACKET',
        422,
      );
    }
    return event;
  }
}

/** The final's rounds of a bracket about to be loaded, by its rounds' slots and its own links (#2006). */
function finalRoundsOfInput(matches: readonly BracketMatchInput[], rounds: readonly SportEventRound[]): Set<number> {
  const slotOf = new Map(rounds.map((round) => [round.roundNumber, round.slot]));
  return finalRoundNumbers(matches.flatMap((match) => {
    const slot = slotOf.get(match.roundNumber);
    return slot === undefined ? [] : [{ roundNumber: match.roundNumber, slot, advances: match.advancesTo !== null }];
  }));
}

/** Whether a bracket reseeds: its rounds' slots are paired by reseeding rather than fixed links (#2006). */
function reseedsOf(rounds: readonly Pick<SportEventRound, 'slot'>[]): boolean {
  return rounds.some((round) => round.slot.pairing === SlotPairing.RESEEDED);
}
