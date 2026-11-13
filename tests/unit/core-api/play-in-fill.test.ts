import { ProviderGameState, type SportEventMatch, type SportEventParticipant } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import { fillPlayInPlaces, type PlayInFillDeps } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/play-in-fill';
import { SportEventError } from '../../../packages/core-api/src/modules/events/errors';
import { bracketMatches } from '../../support/bracket-fixtures';
import { fakeLogger } from '../../support/fake-logger';
import { mockFn } from '../../support/mock-fn';

// A First Four winner fills its play-in place through the admin's own path (#1571).
// Field row `sep-<team>` plays for participant `p-<team>`; the provider calls the team `bdl-<team>`.
// Midwest: Houston (1) plays the 16 seed play-in place "UMBC / Howard", `sep-PLAYIN16`.
// East: Duke (1) plays Mount St. Mary's (16), a team; South: the place `sep-PLAYIN16S` plays Auburn (1), listed at home.

const EVENT_ID = 'event-1';
const T0 = new Date('2027-03-01T00:00:00.000Z');

function row(id: string, isPlayInPlace = false): SportEventParticipant {
  return {
    id,
    sportEventId: EVENT_ID,
    participantId: id.replace('sep-', 'p-'),
    isActive: true,
    isPlayInPlace,
    metadata: {},
    createdAt: T0,
    updatedAt: T0,
  };
}

const FIELD = [row('sep-HOU'), row('sep-PLAYIN16', true), row('sep-DUKE'), row('sep-MSM'), row('sep-AUB'), row('sep-PLAYIN16S', true)];

function bracket(): SportEventMatch[] {
  return bracketMatches(EVENT_ID, [
    { matchNumber: 1, round: 1, home: 'sep-HOU', away: 'sep-PLAYIN16', region: 'Midwest' },
    { matchNumber: 2, round: 1, home: 'sep-DUKE', away: 'sep-MSM', region: 'East' },
    { matchNumber: 3, round: 1, home: 'sep-PLAYIN16S', away: 'sep-AUB', region: 'South' },
    { matchNumber: 4, round: 2, home: null, away: null },
  ]);
}

/** A round of 64 game the provider names a First Four winner in. */
function game(home: string, away: string, playInWinner?: string, externalGameId = 'g1'): GameScoreUpdate {
  return {
    externalGameId,
    homeTeamExternalId: `bdl-${home}`,
    awayTeamExternalId: `bdl-${away}`,
    state: ProviderGameState.SCHEDULED,
    homeScore: null,
    awayScore: null,
    ...(playInWinner ? { playInWinnerTeamExternalId: `bdl-${playInWinner}` } : {}),
  };
}

function filler(field: readonly SportEventParticipant[] = FIELD, unmappedTeams: readonly string[] = []) {
  const findBySportEvent = mockFn<PlayInFillDeps['eventParticipants']['findBySportEvent']>(async () => [...field]);
  const findByProviderExternalIds = mockFn<PlayInFillDeps['mappings']['findByProviderExternalIds']>(async (providerId, ids) => ids
    .filter((id) => !unmappedTeams.includes(id))
    .map((externalId) => ({
      id: `map-${externalId}`, providerId, externalId, participantId: externalId.replace('bdl-', 'p-'),
    } as Awaited<ReturnType<PlayInFillDeps['mappings']['findByProviderExternalIds']>>[number])));
  const fillPlayInSlot = mockFn<PlayInFillDeps['playIns']['fillPlayInSlot']>(async () => undefined);
  const logger = fakeLogger();
  const deps: PlayInFillDeps = {
    providerId: 'balldontlie',
    eventParticipants: { findBySportEvent },
    mappings: { findByProviderExternalIds },
    playIns: { fillPlayInSlot },
    logger,
  };
  return { deps, findBySportEvent, findByProviderExternalIds, fillPlayInSlot, logger };
}

const warnedActions = (logger: ReturnType<typeof fakeLogger>) => logger.warn.mock.calls.map(([fields]) => (fields as { action: string }).action);

describe('filling a play-in place from the provider\'s First Four winner', () => {
  it('fills the place on the other side of the one match the winner\'s round of 64 opponent plays, with the winner', async () => {
    const { deps, fillPlayInSlot, findByProviderExternalIds } = filler();

    await fillPlayInPlaces(deps, EVENT_ID, bracket(), [game('HOU', 'UMBC', 'UMBC')]);

    expect(fillPlayInSlot).toHaveBeenCalledTimes(1);
    expect(fillPlayInSlot).toHaveBeenCalledWith(EVENT_ID, 'sep-PLAYIN16', 'p-UMBC');
    expect(findByProviderExternalIds).toHaveBeenCalledWith('balldontlie', ['bdl-UMBC', 'bdl-HOU']);
  });

  it('finds the place whichever side the provider lists the winner on, and whichever side of the match the place is', async () => {
    const { deps, fillPlayInSlot } = filler();

    await fillPlayInPlaces(deps, EVENT_ID, bracket(), [game('UMBC', 'HOU', 'UMBC'), game('NCAT', 'AUB', 'NCAT', 'g3')]);

    expect(fillPlayInSlot.mock.calls).toEqual([[EVENT_ID, 'sep-PLAYIN16', 'p-UMBC'], [EVENT_ID, 'sep-PLAYIN16S', 'p-NCAT']]);
  });

  it('leaves a place already filled alone: the field has no play-in place left, so nothing is mapped or filled', async () => {
    const filledField = FIELD.map((each) => (each.isPlayInPlace ? { ...each, isPlayInPlace: false } : each));
    const { deps, fillPlayInSlot, findByProviderExternalIds } = filler(filledField);

    await fillPlayInPlaces(deps, EVENT_ID, bracket(), [game('HOU', 'UMBC', 'UMBC')]);

    expect(findByProviderExternalIds).not.toHaveBeenCalled();
    expect(fillPlayInSlot).not.toHaveBeenCalled();
  });

  it('leaves alone a pairing the game does not fit: an opponent whose match is against a team, not a play-in place', async () => {
    const { deps, fillPlayInSlot, logger } = filler();

    await fillPlayInPlaces(deps, EVENT_ID, bracket(), [game('DUKE', 'UMBC', 'UMBC')]);

    expect(fillPlayInSlot).not.toHaveBeenCalled();
    expect(warnedActions(logger)).toEqual(['liveScore.playIn.noSinglePlace']);
  });

  it('leaves it for the admin when the opponent plays two play-in places, never guessing which', async () => {
    const twice = [...bracket(), ...bracketMatches(EVENT_ID, [{ matchNumber: 5, round: 1, home: 'sep-HOU', away: 'sep-PLAYIN16S' }])];
    const { deps, fillPlayInSlot, logger } = filler();

    await fillPlayInPlaces(deps, EVENT_ID, twice, [game('HOU', 'UMBC', 'UMBC')]);

    expect(fillPlayInSlot).not.toHaveBeenCalled();
    expect(warnedActions(logger)).toEqual(['liveScore.playIn.noSinglePlace']);
  });

  it('leaves it for the admin when the site has no team for the winner, or the opponent is not on the field', async () => {
    const unmapped = filler(FIELD, ['bdl-UMBC']);
    await fillPlayInPlaces(unmapped.deps, EVENT_ID, bracket(), [game('HOU', 'UMBC', 'UMBC')]);
    expect(unmapped.fillPlayInSlot).not.toHaveBeenCalled();
    expect(warnedActions(unmapped.logger)).toEqual(['liveScore.playIn.teamNotOnSite']);

    const offField = filler();
    await fillPlayInPlaces(offField.deps, EVENT_ID, bracket(), [game('ALA', 'UMBC', 'UMBC')]);
    expect(offField.fillPlayInSlot).not.toHaveBeenCalled();
    expect(warnedActions(offField.logger)).toEqual(['liveScore.playIn.teamNotOnSite']);

    const opponentUnmapped = filler(FIELD, ['bdl-HOU']);
    await fillPlayInPlaces(opponentUnmapped.deps, EVENT_ID, bracket(), [game('HOU', 'UMBC', 'UMBC')]);
    expect(opponentUnmapped.fillPlayInSlot).not.toHaveBeenCalled();
    expect(warnedActions(opponentUnmapped.logger)).toEqual(['liveScore.playIn.teamNotOnSite']);
  });

  it('logs a place that refuses the winner and goes on to the next game', async () => {
    const { deps, fillPlayInSlot, logger } = filler();
    fillPlayInSlot.mockRejectedValueOnce(new SportEventError('UMBC is already on the field.', 'EVENT_PARTICIPANT_ALREADY_ON_FIELD', 409));

    await fillPlayInPlaces(deps, EVENT_ID, bracket(), [game('HOU', 'UMBC', 'UMBC'), game('AUB', 'NCAT', 'NCAT', 'g3')]);

    expect(fillPlayInSlot).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls.map(([fields]) => fields)).toEqual([
      { action: 'liveScore.playIn.refused', data: { sportEventId: EVENT_ID, externalGameId: 'g1', winnerExternalId: 'bdl-UMBC', opponentExternalId: 'bdl-HOU', code: 'EVENT_PARTICIPANT_ALREADY_ON_FIELD' } },
    ]);
  });

  it('lets an unexpected failure through rather than reading it as a refusal', async () => {
    const { deps, fillPlayInSlot } = filler();
    fillPlayInSlot.mockRejectedValueOnce(new Error('connection lost'));

    await expect(fillPlayInPlaces(deps, EVENT_ID, bracket(), [game('HOU', 'UMBC', 'UMBC')])).rejects.toThrow('connection lost');
  });

  it('fills a place once when two games in a batch both fit it', async () => {
    const { deps, fillPlayInSlot, logger } = filler();

    await fillPlayInPlaces(deps, EVENT_ID, bracket(), [game('HOU', 'UMBC', 'UMBC'), game('HOU', 'HOW', 'HOW', 'g9')]);

    expect(fillPlayInSlot.mock.calls).toEqual([[EVENT_ID, 'sep-PLAYIN16', 'p-UMBC']]);
    expect(warnedActions(logger)).toEqual(['liveScore.playIn.noSinglePlace']);
  });

  it('reads nothing for a batch with no First Four winner, or whose winner\'s game is already linked to a match', async () => {
    const linkedBracket = bracket().map((match) => (match.matchNumber === 1 ? { ...match, externalGameId: 'g1' } : match));
    const { deps, findBySportEvent, fillPlayInSlot } = filler();

    await fillPlayInPlaces(deps, EVENT_ID, bracket(), [game('DUKE', 'MSM')]);
    await fillPlayInPlaces(deps, EVENT_ID, linkedBracket, [game('HOU', 'UMBC', 'UMBC')]);

    expect(findBySportEvent).not.toHaveBeenCalled();
    expect(fillPlayInSlot).not.toHaveBeenCalled();
  });
});
