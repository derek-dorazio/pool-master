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
 * The March Madness First Four is not played here: each play-in place is one field row standing
 * for the pairing, which `fillPlayInSlot` points at the winning team once the game is played.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantRepository,
  SportEventMatchPatch,
  SportEventMatchRepository,
  SportEventMatchWrite,
  SportEventParticipantRepository,
  SportEventRepository,
  SportEventRoundRepository,
} from '@poolmaster/shared/db';
import {
  getSportDefinition,
  MatchSide,
  MatchStatus,
  ParticipantStatus,
  sportPlaysBracket,
  SportEventStatus,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { SportEventError } from './errors';

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
  /** Null for the final, the one match whose winner goes nowhere. */
  advancesTo: BracketAdvance | null;
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
 * Everything wrong with a bracket's shape, in words an admin can act on; empty when it can be
 * loaded. A side may be empty here (its team is not known yet), but never both named and filled
 * by an earlier match's winner.
 */
export function findBracketProblems(
  matches: readonly BracketMatchInput[],
  context: { roundNumbers: ReadonlySet<number>; fieldIds: ReadonlySet<string> },
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

  const finals = matches.filter((match) => match.advancesTo === null);
  if (finals.length !== 1) {
    problems.push(`a bracket has one final, the one match whose winner advances nowhere, but this one has ${finals.length}`);
  } else {
    const lastRound = Math.max(...matches.map((match) => match.roundNumber));
    if (finals[0].roundNumber !== lastRound) {
      problems.push(`the final, match ${finals[0].matchNumber}, is not in the bracket's last round (round ${lastRound})`);
    }
  }
  return problems;
}

export interface SportEventBracketServiceDeps {
  sportEvents: Pick<SportEventRepository, 'findById'>;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvent'>;
  field: SportEventParticipantRepository;
  participants: Pick<ParticipantRepository, 'findById'>;
  matches: SportEventMatchRepository;
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
    });
    if (problems.length > 0) {
      this.deps.logger?.warn({ sportEventId, matches: matches.length, problems }, 'Refused a bracket with problems');
      throw new SportEventError(`The bracket cannot be loaded: ${problems.join('; ')}.`, 'BRACKET_INVALID', 422);
    }

    const newId = this.deps.newId ?? randomUUID;
    const idByNumber = new Map(matches.map((match) => [match.matchNumber, newId()]));
    const writes: SportEventMatchWrite[] = matches.map(({ advancesTo, ...match }) => ({
      ...match,
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
    await this.deps.matches.update(match.id, edit);
    this.deps.logger?.info({ sportEventId, matchNumber, changesSides }, 'Updated bracket match');
    const updated = (await this.deps.matches.findBySportEvent(sportEventId)).find((candidate) => candidate.id === match.id);
    return updated as SportEventMatch;
  }

  /**
   * What still stops the event's release on its bracket's account (design Q3.6), in words an
   * admin can act on: every side of every match named or filled by an earlier winner, every
   * active field member in the bracket, and nobody withdrawn left in it. Empty for an event whose
   * sport plays no bracket.
   */
  async releaseBlockers(event: SportEvent): Promise<string[]> {
    if (!sportPlaysBracket(event.sport)) {
      return [];
    }
    const [bracket, field] = await Promise.all([
      this.deps.matches.findBySportEvent(event.id),
      this.deps.field.findBySportEvent(event.id),
    ]);
    if (bracket.length === 0) {
      return ['its bracket is not loaded'];
    }
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
        } else if (!fed.has(`${match.id}/${side}`)) {
          emptySides += 1;
        }
      }
    }

    const { participant } = getSportDefinition(event.sport).vocabulary;
    const blockers: string[] = [];
    if (emptySides > 0) {
      blockers.push(`${emptySides} bracket place(s) have no ${participant.one} and no earlier match to fill them`);
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
    if (!sportPlaysBracket(event.sport)) {
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
