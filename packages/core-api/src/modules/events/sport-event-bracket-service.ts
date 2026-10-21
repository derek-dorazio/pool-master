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
 * A sport league whose bracket reseeds (BracketAdvancement.RESEED_BY_SEED, the NFL) leaves the
 * matches of a round before a reseed without links. Once every game of that round is final the
 * admin places the next round's teams region by region (`setRoundMatchups`), from the pairing the
 * server proposes from seeds (`proposeRoundMatchups`, bracket-reseed.ts).
 *
 * The March Madness First Four is not played here: each play-in place is one field row standing
 * for the pairing, which `fillPlayInSlot` points at the winning team once the game is played.
 *
 * A named participant who withdraws after the draw (a tennis lucky loser's chance, #704) is
 * replaced in its bracket place by `replaceWithdrawn` until its first match starts, in any sport.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryMatchPredictionRepository,
  ParticipantRepository,
  ReplacementValuation,
  SportLeagueRepository,
  SportEventMatchPatch,
  SportEventMatchRepository,
  SportEventMatchWrite,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventRepository,
  SportEventRoundRepository,
  SportEventTierRepository,
} from '@poolmaster/shared/db';
import {
  BracketAdvancement,
  eventRoundLabel,
  getSportDefinition,
  MatchSide,
  MatchStatus,
  ParticipantStatus,
  sportPlaysMatches,
  SportEventStatus,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { SportEventError } from './errors';
import { findReseededPlaceGaps, findRoundMatchupProblems, proposeRoundMatchups, reseededRounds, roundPlacementBlocker, type RoundMatchup } from './bracket-reseed';

/** Where a match's winner moves on to: the next match, by number, and the side it fills there. */
export interface BracketAdvance {
  matchNumber: number;
  side: MatchSide;
}

/** One match of a bracket as the admin loads it. */
export interface BracketMatchInput {
  matchNumber: number;
  roundNumber: number;
  homeSportEventParticipantId: string | null;
  awaySportEventParticipantId: string | null;
  isNeutralSite: boolean;
  scheduledDate: Date | null;
  /** Null for the final, the one match whose winner goes nowhere; in a reseeded bracket, also a match before a reseed. */
  advancesTo: BracketAdvance | null;
  /** The bracket region or conference; omitted or null where the bracket has none. */
  regionLabel?: string | null;
}

/** One match edit; a value left out keeps what is stored. */
export type BracketMatchEdit = SportEventMatchPatch;

const SIDES = [MatchSide.HOME, MatchSide.AWAY] as const;

function sideOf(match: Pick<BracketMatchInput, 'homeSportEventParticipantId' | 'awaySportEventParticipantId'>, side: MatchSide): string | null {
  return side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
}

/** "match 3 home": a side of a match, as the problems name it. */
function describeSide(matchNumber: number, side: MatchSide): string {
  return `match ${matchNumber} ${side.toLowerCase()}`;
}

/**
 * Whether the games are a set of games rather than a bracket (an NFL regular-season week, #715):
 * one round, none linking anywhere. Unlinked games over several rounds are still a (reseeded)
 * bracket. `links` says whether a game sends its winner on, for a loaded match or one being loaded.
 */
export function formsNoBracket<M extends { roundNumber: number }>(matches: readonly M[], links: (match: M) => boolean): boolean {
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
  context: { roundNumbers: ReadonlySet<number>; fieldIds: ReadonlySet<string>; reseeds?: boolean },
): string[] {
  const problems: string[] = [];
  const byNumber = new Map<number, BracketMatchInput>();
  for (const match of matches) {
    if (byNumber.has(match.matchNumber)) {
      problems.push(`match number ${match.matchNumber} is used more than once`);
    }
    byNumber.set(match.matchNumber, match);
  }

  const sideOwner = new Map<string, string>();
  const fedSides = new Set<string>();
  for (const match of matches) {
    if (!context.roundNumbers.has(match.roundNumber)) {
      problems.push(`match ${match.matchNumber} is in round ${match.roundNumber}, which the event does not have`);
    }
    for (const side of SIDES) {
      const sportEventParticipantId = sideOf(match, side);
      if (sportEventParticipantId === null) continue;
      if (!context.fieldIds.has(sportEventParticipantId)) {
        problems.push(`${describeSide(match.matchNumber, side)} names ${sportEventParticipantId}, which is not on the event's field`);
        continue;
      }
      const owner = sideOwner.get(sportEventParticipantId);
      if (owner !== undefined) {
        problems.push(`${describeSide(match.matchNumber, side)} names the same field row as ${owner}`);
      } else {
        sideOwner.set(sportEventParticipantId, describeSide(match.matchNumber, side));
      }
    }

    const { advancesTo } = match;
    if (advancesTo === null) continue;
    const next = byNumber.get(advancesTo.matchNumber);
    if (!next) {
      problems.push(`match ${match.matchNumber} advances to match ${advancesTo.matchNumber}, which the bracket does not have`);
      continue;
    }
    if (next.roundNumber <= match.roundNumber) {
      problems.push(`match ${match.matchNumber} advances to match ${advancesTo.matchNumber}, which is not in a later round`);
    }
    const fed = describeSide(advancesTo.matchNumber, advancesTo.side);
    if (fedSides.has(fed)) {
      problems.push(`two matches advance to ${fed}`);
    }
    fedSides.add(fed);
    if (sideOf(next, advancesTo.side) !== null) {
      problems.push(`${fed} names a team, but match ${match.matchNumber}'s winner fills it`);
    }
  }

  // A set of games has no final to find.
  if (formsNoBracket(matches, (match) => match.advancesTo !== null)) {
    return problems;
  }
  const lastRound = Math.max(...matches.map((match) => match.roundNumber));
  const finals = matches.filter((match) => match.advancesTo === null && (context.reseeds !== true || match.roundNumber === lastRound));
  if (context.reseeds === true && finals.length !== 1) {
    problems.push(`a bracket has one final, the one match in its last round, but this one has ${finals.length} in round ${lastRound}`);
  } else if (finals.length !== 1) {
    problems.push(`a bracket has one final, the one match whose winner advances nowhere, but this one has ${finals.length}`);
  } else {
    if (finals[0].roundNumber !== lastRound) {
      problems.push(`the final, match ${finals[0].matchNumber}, is not in the bracket's last round (round ${lastRound})`);
    }
  }
  return problems;
}

export interface SportEventBracketServiceDeps {
  sportEvents: Pick<SportEventRepository, 'findById'>;
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvent'>;
  field: SportEventParticipantRepository;
  participants: Pick<ParticipantRepository, 'findById'>;
  matches: SportEventMatchRepository;
  /** The event's tiers and valuations, which a replacement joins at the bottom of. */
  tiers: Pick<SportEventTierRepository, 'findBySportEvent'>;
  valuations: Pick<SportEventParticipantValuationRepository, 'findBySportEvent'>;
  /** Whether a game has picks: a released game's spread is fixed once it has (#720). */
  predictions: Pick<ContestEntryMatchPredictionRepository, 'hasAnyOnMatch'>;
  newId?: () => string;
  logger?: FastifyBaseLogger;
}

export class SportEventBracketService {
  constructor(private readonly deps: SportEventBracketServiceDeps) {}

  /** The bracket in match-number order; empty until it is loaded. */
  async listBracket(sportEventId: string): Promise<SportEventMatch[]> {
    await this.requireBracketEvent(sportEventId);
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /**
   * Replaces the event's bracket with `matches`, all or none. 409 SPORT_EVENT_BRACKET_LOCKED once
   * the event is released; 422 BRACKET_INVALID with every problem found when its shape is wrong.
   */
  async loadBracket(sportEventId: string, matches: readonly BracketMatchInput[]): Promise<SportEventMatch[]> {
    const event = await this.requireBracketEvent(sportEventId);
    this.assertPairingsEditable(event);
    const [rounds, field] = await Promise.all([
      this.deps.rounds.findBySportEvent(sportEventId),
      this.deps.field.findBySportEvent(sportEventId),
    ]);
    const problems = findBracketProblems(matches, {
      roundNumbers: new Set(rounds.map((round) => round.roundNumber)),
      fieldIds: new Set(field.map((entry) => entry.id)),
      reseeds: await this.reseeds(event),
    });
    if (problems.length > 0) {
      this.deps.logger?.warn({ sportEventId, matches: matches.length, problems }, 'Refused a bracket with problems');
      throw new SportEventError(`The bracket cannot be loaded: ${problems.join('; ')}.`, 'BRACKET_INVALID', 422);
    }

    const newId = this.deps.newId ?? randomUUID;
    const idByNumber = new Map(matches.map((match) => [match.matchNumber, newId()]));
    const writes: SportEventMatchWrite[] = matches.map(({ advancesTo, regionLabel, ...match }) => ({
      ...match,
      regionLabel: regionLabel ?? null,
      id: idByNumber.get(match.matchNumber) as string,
      advancesToMatchId: advancesTo ? idByNumber.get(advancesTo.matchNumber) as string : null,
      advancesToSide: advancesTo?.side ?? null,
    }));
    await this.deps.matches.replaceBracket(sportEventId, writes);
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
  async updateMatch(sportEventId: string, matchNumber: number, edit: BracketMatchEdit): Promise<SportEventMatch> {
    const event = await this.requireBracketEvent(sportEventId);
    const bracket = await this.deps.matches.findBySportEvent(sportEventId);
    const match = bracket.find((candidate) => candidate.matchNumber === matchNumber);
    if (!match) {
      throw new SportEventError(`Sport event ${sportEventId} has no match ${matchNumber}.`, 'BRACKET_MATCH_NOT_FOUND', 404);
    }

    const changesSides = edit.homeSportEventParticipantId !== undefined || edit.awaySportEventParticipantId !== undefined;
    if (changesSides) {
      this.assertPairingsEditable(event);
      const problems = await this.findSideEditProblems(match, bracket, edit);
      if (problems.length > 0) {
        this.deps.logger?.warn({ sportEventId, matchNumber, problems }, 'Refused a match edit with problems');
        throw new SportEventError(`Match ${matchNumber} cannot be changed: ${problems.join('; ')}.`, 'BRACKET_INVALID', 422);
      }
    }
    const changesSpread = edit.homeSpread !== undefined && edit.homeSpread !== match.homeSpread;
    if (changesSpread && event.status !== SportEventStatus.DRAFT) {
      this.assertSpreadKept(event, match, edit.homeSpread);
      await this.assertSpreadUnpicked(event, match);
    }
    await this.deps.matches.update(match.id, edit);
    this.deps.logger?.info({ sportEventId, matchNumber, changesSides, changesSpread }, 'Updated bracket match');
    const updated = (await this.deps.matches.findBySportEvent(sportEventId)).find((candidate) => candidate.id === match.id);
    return updated as SportEventMatch;
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
    if (!sportPlaysMatches(event.sport)) {
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
    const sportLeague = await this.deps.sportLeagues.findById(event.sportLeagueId);
    const reseeds = sportLeague?.bracketAdvancement === BracketAdvancement.RESEED_BY_SEED;
    const placedLater = reseeds ? reseededRounds(bracket) : new Set<number>();
    const fed = new Set(bracket
      .filter((match) => match.advancesToMatchId !== null && match.advancesToSide !== null)
      .map((match) => `${match.advancesToMatchId}/${match.advancesToSide}`));
    const named = new Set<string>();
    let emptySides = 0;
    for (const match of bracket) {
      for (const side of SIDES) {
        const sportEventParticipantId = sideOf(match, side);
        if (sportEventParticipantId !== null) {
          named.add(sportEventParticipantId);
        } else if (!fed.has(`${match.id}/${side}`) && !placedLater.has(match.roundNumber)) {
          emptySides += 1;
        }
      }
    }

    const { participant } = getSportDefinition(event.sport).vocabulary;
    const blockers: string[] = [];
    if (emptySides > 0) {
      blockers.push(`${emptySides} bracket place(s) have no ${participant.one} and no earlier match to fill them`);
    }
    if (reseeds) {
      const roundCount = event.rounds ?? Math.max(...bracket.map((match) => match.roundNumber));
      const roundLabel = (roundNumber: number): string => eventRoundLabel(event.sport, sportLeague.roundNames, roundNumber, roundCount);
      for (const gap of findReseededPlaceGaps(bracket)) {
        const where = gap.regionLabel === null ? roundLabel(gap.roundNumber) : `${roundLabel(gap.roundNumber)} in ${gap.regionLabel}`;
        blockers.push(`${where} has ${gap.openPlaces} open place(s) for ${gap.winnersToCome} ${roundLabel(gap.roundNumber - 1)} winner(s) still to come`);
      }
    }
    const missing = field.filter((entry) => entry.isActive && !named.has(entry.id)).length;
    if (missing > 0) {
      blockers.push(`${missing} active ${participant.many} are not in the bracket`);
    }
    const withdrawn = field.filter((entry) => !entry.isActive && named.has(entry.id)).length;
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
  async setRoundMatchups(sportEventId: string, roundNumber: number, matchups: readonly RoundMatchup[]): Promise<SportEventMatch[]> {
    const { bracket, seedOf } = await this.requireReseededRound(sportEventId, roundNumber);
    const problems = findRoundMatchupProblems(bracket, roundNumber, matchups, seedOf);
    if (problems.length > 0) {
      this.deps.logger?.warn({ sportEventId, roundNumber, problems }, 'Refused a reseeded round with problems');
      throw new SportEventError(`Round ${roundNumber} cannot be set: ${problems.join('; ')}.`, 'BRACKET_INVALID', 422);
    }
    const idByNumber = new Map(bracket.map((match) => [match.matchNumber, match.id]));
    await this.deps.matches.placeSides(matchups.map((matchup) => ({
      id: idByNumber.get(matchup.matchNumber) as string,
      homeSportEventParticipantId: matchup.homeSportEventParticipantId,
      awaySportEventParticipantId: matchup.awaySportEventParticipantId,
    })));
    this.deps.logger?.info({ sportEventId, roundNumber, matches: matchups.length }, 'Placed a reseeded round');
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /** The bracket and its seeds, for a released event's reseeded round that can be placed now. */
  private async requireReseededRound(sportEventId: string, roundNumber: number): Promise<{ bracket: SportEventMatch[]; seedOf: Map<string, number | null> }> {
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

  /** Whether the event's sport league reseeds its bracket; a missing sport league reads as fixed. */
  private async reseeds(event: SportEvent): Promise<boolean> {
    const sportLeague = await this.deps.sportLeagues.findById(event.sportLeagueId);
    return sportLeague?.bracketAdvancement === BracketAdvancement.RESEED_BY_SEED;
  }

  /**
   * The First Four (design Q3.7): points a play-in place's field row, which stands for the
   * pairing ("Texas / Xavier"), at the team that won the play-in, and inactivates the pairing's
   * participant. The row keeps its seed, tier, price and every pick of it, and is no longer a
   * play-in place. 404 EVENT_PARTICIPANT_NOT_FOUND for a row not on the event, 409
   * EVENT_PARTICIPANT_NOT_PLAY_IN_PLACE for a row not marked as one (#709: filling Duke's row would
   * make every pick of Duke a pick of the winner), 404 PARTICIPANT_NOT_FOUND for a
   * winner that is not a participant of the event's sport, 409 EVENT_PARTICIPANT_ALREADY_ON_FIELD
   * when the winner already has a field row, 409 PLAY_IN_SLOT_ALREADY_PLAYED once the place has
   * played or started a bracket match.
   */
  async fillPlayInSlot(sportEventId: string, sportEventParticipantId: string, winnerParticipantId: string): Promise<void> {
    await this.requireBracketEvent(sportEventId);
    const entry = await this.deps.field.findById(sportEventParticipantId);
    if (!entry || entry.sportEventId !== sportEventId) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is not on sport event ${sportEventId}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    if (!entry.isPlayInPlace) {
      this.deps.logger?.warn({ sportEventId, sportEventParticipantId }, 'Refused to fill a field row that is not a play-in place');
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is not a play-in place, so it cannot take a play-in winner.`,
        'EVENT_PARTICIPANT_NOT_PLAY_IN_PLACE',
        409,
      );
    }
    const [pairing, winner] = await Promise.all([
      this.deps.participants.findById(entry.participantId),
      this.deps.participants.findById(winnerParticipantId),
    ]);
    if (!pairing || !winner || winner.sportId !== pairing.sportId || winner.status !== ParticipantStatus.ACTIVE) {
      throw new SportEventError(
        `Participant ${winnerParticipantId} is not an active participant of this event's sport.`,
        'PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    const field = await this.deps.field.findBySportEvent(sportEventId);
    if (field.some((row) => row.participantId === winnerParticipantId)) {
      throw new SportEventError(
        `${winner.name} is already on sport event ${sportEventId}'s field.`,
        'EVENT_PARTICIPANT_ALREADY_ON_FIELD',
        409,
      );
    }
    const played = (await this.deps.matches.findBySportEvent(sportEventId)).some((match) => (
      match.status !== MatchStatus.SCHEDULED
      && (match.homeSportEventParticipantId === entry.id || match.awaySportEventParticipantId === entry.id)
    ));
    if (played) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} has already played in the bracket, so its team can no longer change.`,
        'PLAY_IN_SLOT_ALREADY_PLAYED',
        409,
      );
    }
    await this.deps.field.fillPlayInSlot({ id: entry.id, winnerParticipantId, pairingParticipantId: pairing.id });
    this.deps.logger?.info(
      { sportEventId, sportEventParticipantId, winnerParticipantId, pairingParticipantId: pairing.id },
      'Filled a play-in place with its winner',
    );
  }

  /**
   * A withdrawal after the draw (#704 slice 3): puts `replacementParticipantId` in the bracket place
   * of a field row that withdrew before its first-round match, before or after release, in any sport.
   * The replacement gets a field row of its own, unseeded, in the event's last tier and at its
   * lowest price, so roster pools can pick it while entries are open; the withdrawn row stays on
   * the field, inactive as WITHDRAWN, keeping every pick of it, which then scores as a first-round
   * loss. 404 EVENT_PARTICIPANT_NOT_FOUND for a row not on the event; 409
   * EVENT_PARTICIPANT_IS_PLAY_IN_PLACE for a play-in place, which is filled instead; 409
   * EVENT_PARTICIPANT_NOT_IN_BRACKET for a row no match names (one already replaced, too); 409
   * BRACKET_PARTICIPANT_ALREADY_PLAYED once its match has started; 409
   * BRACKET_PLACE_NOT_FIRST_ROUND for a place after the first round (a bye); and the play-in winner's
   * refusals for the replacement: 404 PARTICIPANT_NOT_FOUND, 409 EVENT_PARTICIPANT_ALREADY_ON_FIELD.
   * Returns the replacement's field row id.
   */
  async replaceWithdrawn(sportEventId: string, sportEventParticipantId: string, replacementParticipantId: string): Promise<string> {
    await this.requireBracketEvent(sportEventId);
    const entry = await this.deps.field.findById(sportEventParticipantId);
    if (!entry || entry.sportEventId !== sportEventId) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is not on sport event ${sportEventId}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    if (entry.isPlayInPlace) {
      this.deps.logger?.warn({ sportEventId, sportEventParticipantId }, 'Refused to replace a play-in place');
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is a play-in place: fill it with its winner instead.`,
        'EVENT_PARTICIPANT_IS_PLAY_IN_PLACE',
        409,
      );
    }
    const bracket = await this.deps.matches.findBySportEvent(sportEventId);
    const named = bracket.flatMap((match) => SIDES.filter((side) => sideOf(match, side) === entry.id).map((side) => ({ match, side })));
    const place = named.at(0);
    if (place === undefined) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} has no place in sport event ${sportEventId}'s bracket.`,
        'EVENT_PARTICIPANT_NOT_IN_BRACKET',
        409,
      );
    }
    // A row in a second match got there by winning the first.
    if (named.length > 1 || place.match.status !== MatchStatus.SCHEDULED) {
      this.deps.logger?.warn({ sportEventId, sportEventParticipantId, matchNumber: place.match.matchNumber }, 'Refused to replace a participant whose match has started');
      throw new SportEventError(
        `Field row ${sportEventParticipantId}'s match ${place.match.matchNumber} has started, so a withdrawal is now a walkover.`,
        'BRACKET_PARTICIPANT_ALREADY_PLAYED',
        409,
      );
    }
    // A pick of a withdrawn row stands only in the bracket's first round, so a place a bye put
    // later is not replaced: the withdrawal is a walkover there.
    if (place.match.roundNumber !== Math.min(...bracket.map((match) => match.roundNumber))) {
      this.deps.logger?.warn({ sportEventId, sportEventParticipantId, matchNumber: place.match.matchNumber }, 'Refused to replace a participant placed after the first round');
      throw new SportEventError(
        `Field row ${sportEventParticipantId}'s place is in round ${place.match.roundNumber}, not the first round, so a withdrawal is a walkover.`,
        'BRACKET_PLACE_NOT_FIRST_ROUND',
        409,
      );
    }
    const [withdrawn, replacement] = await Promise.all([
      this.deps.participants.findById(entry.participantId),
      this.deps.participants.findById(replacementParticipantId),
    ]);
    if (!withdrawn || !replacement || replacement.sportId !== withdrawn.sportId || replacement.status !== ParticipantStatus.ACTIVE) {
      throw new SportEventError(
        `Participant ${replacementParticipantId} is not an active participant of this event's sport.`,
        'PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    const field = await this.deps.field.findBySportEvent(sportEventId);
    if (field.some((row) => row.participantId === replacementParticipantId)) {
      throw new SportEventError(
        `${replacement.name} is already on sport event ${sportEventId}'s field.`,
        'EVENT_PARTICIPANT_ALREADY_ON_FIELD',
        409,
      );
    }

    const replacementId = await this.deps.field.replaceWithdrawn({
      withdrawnId: entry.id,
      matchId: place.match.id,
      side: place.side,
      replacementParticipantId,
      valuation: await this.bottomValuation(sportEventId),
    });
    this.deps.logger?.info(
      { sportEventId, withdrawnId: entry.id, replacementId, replacementParticipantId, matchNumber: place.match.matchNumber, side: place.side },
      'Replaced a withdrawn participant in the bracket',
    );
    return replacementId;
  }

  /**
   * Where a replacement joins the event's valuations: last in its last tier, at the field's
   * lowest price, the bottom of the budget curve. Null when the event has neither tiers nor prices.
   */
  private async bottomValuation(sportEventId: string): Promise<ReplacementValuation | null> {
    const [tiers, valuations] = await Promise.all([
      this.deps.tiers.findBySportEvent(sportEventId),
      this.deps.valuations.findBySportEvent(sportEventId),
    ]);
    const lastTier = tiers.at(-1) ?? null;
    const prices = valuations.flatMap((valuation) => (valuation.price === null ? [] : [valuation.price]));
    const price = prices.length > 0 ? Math.min(...prices) : null;
    if (lastTier === null && price === null) {
      return null;
    }
    const orders = valuations
      .filter((valuation) => lastTier !== null && valuation.sportEventTierId === lastTier.id)
      .flatMap((valuation) => (valuation.tierOrderIndex === null ? [] : [valuation.tierOrderIndex]));
    return {
      sportEventTierId: lastTier?.id ?? null,
      tierOrderIndex: lastTier === null ? null : Math.max(0, ...orders) + 1,
      price,
    };
  }

  private async findSideEditProblems(
    match: SportEventMatch,
    bracket: readonly SportEventMatch[],
    edit: BracketMatchEdit,
  ): Promise<string[]> {
    const field = new Set((await this.deps.field.findBySportEvent(match.sportEventId)).map((entry) => entry.id));
    const after = {
      homeSportEventParticipantId: edit.homeSportEventParticipantId === undefined ? match.homeSportEventParticipantId : edit.homeSportEventParticipantId,
      awaySportEventParticipantId: edit.awaySportEventParticipantId === undefined ? match.awaySportEventParticipantId : edit.awaySportEventParticipantId,
    };
    const problems: string[] = [];
    if (after.homeSportEventParticipantId !== null && after.homeSportEventParticipantId === after.awaySportEventParticipantId) {
      problems.push('both sides name the same team');
    }
    for (const side of SIDES) {
      const sportEventParticipantId = sideOf(after, side);
      if (sportEventParticipantId === null || sportEventParticipantId === sideOf(match, side)) continue;
      if (!field.has(sportEventParticipantId)) {
        problems.push(`the ${side.toLowerCase()} side names ${sportEventParticipantId}, which is not on the event's field`);
        continue;
      }
      if (bracket.some((other) => other.advancesToMatchId === match.id && other.advancesToSide === side)) {
        problems.push(`the ${side.toLowerCase()} side is filled by an earlier match's winner`);
      }
      const elsewhere = bracket.find((other) => other.id !== match.id
        && (other.homeSportEventParticipantId === sportEventParticipantId || other.awaySportEventParticipantId === sportEventParticipantId));
      if (elsewhere) {
        problems.push(`the ${side.toLowerCase()} side names a team already in match ${elsewhere.matchNumber}`);
      }
    }
    return problems;
  }

  /**
   * A released game keeps a spread once it has one (#720): a pool against the spread checked every
   * spread when it took the week and never checks again, so a cleared spread would score every
   * pick on the game as a push. 422 MATCH_SPREAD_REQUIRED.
   */
  private assertSpreadKept(event: SportEvent, match: SportEventMatch, homeSpread: number | null | undefined): void {
    if (homeSpread === null) {
      this.deps.logger?.warn({ sportEventId: event.id, matchNumber: match.matchNumber }, 'Refused clearing a released game\'s spread');
      throw new SportEventError(
        `Match ${match.matchNumber} has been released, so its spread can be changed but not cleared.`,
        'MATCH_SPREAD_REQUIRED',
        422,
      );
    }
  }

  /**
   * A released game's spread is corrected only while nobody has picked the game (#720, design
   * Q5.9): a correction then changes no pick already made. 409 MATCH_SPREAD_LOCKED after that.
   */
  private async assertSpreadUnpicked(event: SportEvent, match: SportEventMatch): Promise<void> {
    if (await this.deps.predictions.hasAnyOnMatch(match.id)) {
      this.deps.logger?.warn({ sportEventId: event.id, matchNumber: match.matchNumber }, 'Refused a spread change on a game that has picks');
      throw new SportEventError(
        `Match ${match.matchNumber} already has picks, so its spread can no longer change.`,
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

  private async requireBracketEvent(sportEventId: string): Promise<SportEvent> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    if (!sportPlaysMatches(event.sport)) {
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
