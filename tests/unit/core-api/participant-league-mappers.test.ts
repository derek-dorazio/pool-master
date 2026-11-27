/**
 * Response mappers for participants, field rows, field uploads, league invitations and stored
 * picks: dates become ISO strings, a value not there becomes null (or is left out where the
 * schema makes it optional), and nested extensions appear only when the row has them.
 */
import type { LeagueInvitation, Participant } from '@poolmaster/shared/domain';
import { InvitationStatus, InviteType } from '@poolmaster/shared/domain';
import { buildInvitation, buildMembership, buildUser } from '../../factories';
import { mapContestEntryPickRowToDomain, type ContestEntryPickRow } from '../../../packages/core-api/src/mappers/contest-entry-picks.mapper';
import { mapLeagueInvitationToDto, mapLeagueMembershipToDto } from '../../../packages/core-api/src/mappers/leagues-extra.mapper';
import {
  mapParticipantProviderMappingToDto,
  mapParticipantToDto,
  toUpdateParticipantInput,
} from '../../../packages/core-api/src/mappers/participants.mapper';
import { mapSportEventParticipantToDto } from '../../../packages/core-api/src/mappers/sport-event-participants.mapper';
import type { SportEventParticipantView } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { golfRound } from '../../support/golf-rounds';

const created = new Date('2026-01-01T00:00:00.000Z');
const updated = new Date('2026-02-01T00:00:00.000Z');

const scottie = {
  id: 'p-scheffler',
  sportId: 'golf',
  name: 'Scottie Scheffler',
  participantType: 'INDIVIDUAL',
  status: 'ACTIVE',
  injuryStatus: { status: 'HEALTHY' },
  externalIds: { pga: '46046' },
  createdAt: created,
  updatedAt: updated,
} as unknown as Participant;

describe('participant mappers', () => {
  it('leaves out the dates a participant does not have', () => {
    const dto = mapParticipantToDto(scottie);

    expect(dto).toMatchObject({ id: 'p-scheffler', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', photoLastUpdated: undefined });
    expect(dto.injuryStatus).toEqual({ status: 'HEALTHY', detail: undefined, expectedReturn: undefined, updatedAt: undefined, source: undefined });
  });

  it('gives an injury its expected return and update time, and a photo its update time, as ISO strings', () => {
    const injured = {
      ...scottie,
      photoLastUpdated: new Date('2026-03-01T00:00:00.000Z'),
      injuryStatus: { status: 'OUT', detail: 'Wrist', expectedReturn: new Date('2026-05-01T00:00:00.000Z'), updatedAt: new Date('2026-04-01T00:00:00.000Z'), source: 'PGA' },
    } as unknown as Participant;

    const dto = mapParticipantToDto(injured);

    expect(dto.photoLastUpdated).toBe('2026-03-01T00:00:00.000Z');
    expect(dto.injuryStatus).toEqual({ status: 'OUT', detail: 'Wrist', expectedReturn: '2026-05-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z', source: 'PGA' });
  });

  it('shows a provider mapping with its sport league, participant type, provider row and name, raw feed id and when it was made', () => {
    expect(mapParticipantProviderMappingToDto({
      id: 'm-1', participantId: 'p-scheffler', sportLeagueId: 'league-pga', participantType: 'INDIVIDUAL',
      providerId: 'provider-row-1', providerName: 'BALLDONTLIE', externalId: '46046', mappedAt: created, createdAt: created, updatedAt: created,
    })).toEqual({
      id: 'm-1',
      participantId: 'p-scheffler',
      sportLeagueId: 'league-pga',
      participantType: 'INDIVIDUAL',
      providerId: 'provider-row-1',
      providerName: 'BALLDONTLIE',
      externalId: '46046',
      mappedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('passes an update with no injury status through as it is', () => {
    expect(toUpdateParticipantInput({ name: 'S. Scheffler' })).toEqual({ name: 'S. Scheffler' });
  });

  it('turns an update\'s injury dates into Dates, and leaves out the ones it does not send', () => {
    expect(toUpdateParticipantInput({
      name: 'S. Scheffler',
      injuryStatus: { status: 'OUT', expectedReturn: '2026-05-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' },
    } as never)).toEqual({
      name: 'S. Scheffler',
      injuryStatus: { status: 'OUT', expectedReturn: new Date('2026-05-01T00:00:00.000Z'), updatedAt: new Date('2026-04-01T00:00:00.000Z') },
    });
    expect(toUpdateParticipantInput({ injuryStatus: { status: 'HEALTHY' } } as never)).toEqual({ injuryStatus: { status: 'HEALTHY' } });
  });
});

describe('field row mappers', () => {
  const entry = {
    id: 'sep-1',
    sportEventId: 'event-1',
    participantId: 'p-scheffler',
    status: 'ACTIVE',
    createdAt: created,
    updatedAt: updated,
  };

  it('gives a bare field row null ranking, odds, seed, valuation, standing and race, and no rounds', () => {
    const dto = mapSportEventParticipantToDto({ entry, participant: scottie, valuation: null, standing: null, rounds: [], fieldResults: [], affiliatedWithSportLeague: true } as unknown as SportEventParticipantView);

    expect(dto).toMatchObject({
      id: 'sep-1',
      status: 'ACTIVE',
      ranking: null,
      oddsToWin: null,
      seedNumber: null,
      valuation: null,
      standing: null,
      rounds: [],
      race: null,
      affiliatedWithSportLeague: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('nests a scored row\'s valuation, its standing with golf detail and its current round read off its rounds, each round from its FIELD Game side', () => {
    const view = {
      entry: { ...entry, status: 'WITHDRAWN', ranking: 1, oddsToWin: 450, seedNumber: 3 },
      participant: scottie,
      valuation: { id: 'v-1', sportEventTierId: 'tier-a', tierOrderIndex: 0, tierAssignedSource: 'MANUAL', price: 12000, priceAssignedSource: 'UPLOAD' },
      standing: { id: 's-1', position: 1, displayPosition: 'T1', status: 'ACTIVE', asOf: new Date('2026-04-12T20:00:00.000Z'), total: 276, scoreToPar: -12 },
      // Each golf round is the row's side result in that round's FIELD Game (#2008).
      fieldResults: [
        {
          ...golfRound({ roundNumber: 1, strokes: 68, scoreToPar: -4, completedAt: new Date('2026-04-09T23:00:00.000Z') }),
          sportEventRoundId: 'er-1',
          result: { ...golfRound({ roundNumber: 1, strokes: 68, scoreToPar: -4 }).result, sportEventRoundMatchSideId: 'side-r1' },
        },
        { ...golfRound({ roundNumber: 2, strokes: 33, scoreToPar: -1, thru: 9, status: null }), sportEventRoundId: 'er-2' },
      ],
      affiliatedWithSportLeague: false,
    } as unknown as SportEventParticipantView;

    const dto = mapSportEventParticipantToDto(view);

    expect(dto).toMatchObject({ status: 'WITHDRAWN', ranking: 1, oddsToWin: 450, seedNumber: 3 });
    expect(dto.valuation).toEqual({ id: 'v-1', sportEventTierId: 'tier-a', tierOrderIndex: 0, tierAssignedSource: 'MANUAL', price: 12000, priceAssignedSource: 'UPLOAD' });
    expect(dto.standing).toEqual({
      id: 's-1',
      position: 1,
      displayPosition: 'T1',
      status: 'ACTIVE',
      asOf: '2026-04-12T20:00:00.000Z',
      // The highest round it has a score in, read off its rounds, and its holes thru there.
      currentRound: 2,
      golf: { eventScoreToPar: -12, eventStrokes: 276, currentRoundThru: 9 },
    });
    expect(dto.rounds).toEqual([
      { id: 'side-r1', sportEventRoundId: 'er-1', roundNumber: 1, status: 'COMPLETED', completedAt: '2026-04-09T23:00:00.000Z', golf: { strokes: 68, scoreToPar: -4, thru: 18 } },
      { id: 'side-2', sportEventRoundId: 'er-2', roundNumber: 2, status: 'IN_PROGRESS', completedAt: null, golf: { strokes: 33, scoreToPar: -1, thru: 9 } },
    ]);
    // A row scored in rounds is a golfer's: it has no race.
    expect(dto.race).toBeNull();
  });

  it('gives a runner its race from the race\'s one FIELD Game, official once the Game is COMPLETED, and no rounds', () => {
    const dto = mapSportEventParticipantToDto({
      entry,
      participant: scottie,
      valuation: null,
      standing: null,
      fieldResults: [{
        sportEventRoundId: 'er-1',
        roundNumber: 1,
        gameStatus: 'COMPLETED',
        gameCompletedAt: null,
        result: { sportEventRoundMatchSideId: 'side-1', sideNumber: 1, score: null, homeAway: 'NONE', position: 2, startPosition: 5, scoreToPar: null, periodsCompleted: null, status: 'FINISHED', periodScores: [] },
        updatedAt: new Date('2026-04-12T20:00:00.000Z'),
      }],
      affiliatedWithSportLeague: true,
    } as unknown as SportEventParticipantView);

    expect(dto.rounds).toEqual([]);
    expect(dto.race).toEqual({ finishPosition: 2, startPosition: 5, resultStatus: 'FINISHED', isOfficial: true });
  });

  it('gives a standing with no time and no golf totals a null as-of and null golf', () => {
    const dto = mapSportEventParticipantToDto({
      entry,
      participant: scottie,
      valuation: null,
      standing: { id: 's-1', position: null, displayPosition: null, status: 'ACTIVE', asOf: null, total: null, scoreToPar: null },
      fieldResults: [],
      affiliatedWithSportLeague: true,
    } as unknown as SportEventParticipantView);

    expect(dto.standing).toMatchObject({ asOf: null, golf: null });
  });

});

describe('league membership and invitation mappers', () => {
  const user = buildUser({ id: 'user-1', email: 'riley@example.test', username: 'riley', firstName: 'Riley', lastName: 'Quinn', createdAt: created });

  it('shows a membership with its dates and the member as a user', () => {
    const dto = mapLeagueMembershipToDto(buildMembership({ id: 'm-1', joinedAt: created, createdAt: created, updatedAt: updated }), user);

    expect(dto).toMatchObject({ id: 'm-1', role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', user: { id: 'user-1', isRootAdmin: false } });
  });

  const joinLink = buildInvitation({
    id: 'inv-1',
    email: undefined,
    inviteCode: 'JOIN123',
    inviteType: InviteType.LINK,
    maxUses: 10,
    currentUses: 2,
    invitedBy: 'user-1',
    expiresAt: undefined,
    createdAt: created,
    updatedAt: updated,
  });

  it('gives a join link with no email, expiry or acceptance, and no email sent, nulls for each', () => {
    expect(mapLeagueInvitationToDto(joinLink, null)).toMatchObject({
      email: null,
      expiresAt: null,
      acceptedAt: null,
      acceptedBy: null,
      emailStatus: null,
      emailSkipReason: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('shows an accepted email invitation with its address, expiry, acceptance and where its email stands', () => {
    const accepted: LeagueInvitation = {
      ...joinLink,
      email: 'sam@example.test',
      inviteType: InviteType.EMAIL,
      status: InvitationStatus.ACCEPTED,
      expiresAt: new Date('2026-03-01T00:00:00.000Z'),
      acceptedAt: new Date('2026-02-15T00:00:00.000Z'),
      acceptedBy: 'user-2',
    };

    expect(mapLeagueInvitationToDto(accepted, { status: 'SKIPPED', skipReason: 'UNSUBSCRIBED' } as never)).toMatchObject({
      email: 'sam@example.test',
      expiresAt: '2026-03-01T00:00:00.000Z',
      acceptedAt: '2026-02-15T00:00:00.000Z',
      acceptedBy: 'user-2',
      emailStatus: 'SKIPPED',
      emailSkipReason: 'UNSUBSCRIBED',
    });
  });
});

describe('stored pick mapper', () => {
  const row: ContestEntryPickRow = {
    id: 'pick-1',
    entryId: 'entry-1',
    sportEventParticipantId: 'sep-1',
    tier: null,
    cost: null,
    isAutoPicked: false,
    lineupSlot: null,
    pickSequence: null,
    pickedAt: created,
    createdAt: created,
    updatedAt: updated,
  };

  it('leaves the optional columns a pick does not have undefined', () => {
    expect(mapContestEntryPickRowToDomain(row)).toEqual({
      id: 'pick-1',
      entryId: 'entry-1',
      sportEventParticipantId: 'sep-1',
      tier: undefined,
      cost: undefined,
      isAutoPicked: false,
      lineupSlot: undefined,
      pickSequence: undefined,
      pickedAt: created,
      createdAt: created,
      updatedAt: updated,
    });
  });

  it('carries every optional column a pick has, reading a Decimal cost as a number', () => {
    expect(mapContestEntryPickRowToDomain({ ...row, tier: 'A', cost: { toNumber: () => 12.5 }, lineupSlot: 1, pickSequence: 7 })).toMatchObject({
      tier: 'A',
      cost: 12.5,
      lineupSlot: 1,
      pickSequence: 7,
    });
  });

  it('keeps a cost already given as a number', () => {
    expect(mapContestEntryPickRowToDomain({ ...row, cost: 9000 }).cost).toBe(9000);
  });
});
