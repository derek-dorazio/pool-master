/**
 * Response mappers for participants, field rows, field uploads, league invitations and stored
 * picks: dates become ISO strings, a value not there becomes null (or is left out where the
 * schema makes it optional), and nested extensions appear only when the row has them.
 */
import type { LeagueInvitation, Participant, User } from '@poolmaster/shared/domain';
import { ContestFormat } from '@poolmaster/shared/domain';
import { mapContestEntryPickRowToDomain, type ContestEntryPickRow } from '../../../packages/core-api/src/mappers/contest-entry-picks.mapper';
import { mapLeagueInvitationToDto, mapLeagueMembershipToDto } from '../../../packages/core-api/src/mappers/leagues-extra.mapper';
import {
  mapParticipantProviderMappingToDto,
  mapParticipantToDto,
  toUpdateParticipantInput,
} from '../../../packages/core-api/src/mappers/participants.mapper';
import { mapFieldUploadPreviewToDto, mapSportEventParticipantToDto } from '../../../packages/core-api/src/mappers/sport-event-participants.mapper';
import type { FieldUploadPreviewRow, SportEventParticipantView } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';

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

  it('shows a provider mapping with its confidence and when it was made', () => {
    expect(mapParticipantProviderMappingToDto({ id: 'm-1', participantId: 'p-scheffler', providerId: 'sportsdata', externalId: '46046', confidence: 0.98, mappedAt: created } as never)).toEqual({
      id: 'm-1',
      participantId: 'p-scheffler',
      providerId: 'sportsdata',
      externalId: '46046',
      confidence: 0.98,
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
    isActive: true,
    isPlayInPlace: false,
    createdAt: created,
    updatedAt: updated,
  };

  it('gives a bare field row null ranking, odds, seed, valuation, standing and race, and no rounds', () => {
    const dto = mapSportEventParticipantToDto({ entry, participant: scottie, valuation: null, standing: null, rounds: [], raceResult: null, affiliatedWithSportLeague: true } as unknown as SportEventParticipantView);

    expect(dto).toMatchObject({
      id: 'sep-1',
      inactiveReason: null,
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

  it('nests a scored row\'s valuation, its standing with golf detail, each round with golf and stat lines, and its race result', () => {
    const view = {
      entry: { ...entry, isActive: false, inactiveReason: 'WITHDRAWN', ranking: 1, oddsToWin: 450, seedNumber: 3 },
      participant: scottie,
      valuation: { id: 'v-1', sportEventTierId: 'tier-a', tierOrderIndex: 0, tierAssignedSource: 'MANUAL', price: 12000, priceAssignedSource: 'UPLOAD' },
      standing: {
        standing: { id: 's-1', position: 1, displayPosition: 'T1', status: 'ACTIVE', asOf: new Date('2026-04-12T20:00:00.000Z'), currentRound: 4 },
        golf: { eventScoreToPar: -12, eventStrokes: 276, currentRoundThru: 18 },
      },
      rounds: [
        { round: { id: 'r-1', sportEventRoundId: 'er-1', roundNumber: 1, status: 'COMPLETE', completedAt: new Date('2026-04-09T23:00:00.000Z') }, golf: { strokes: 68, scoreToPar: -4, thru: 18 }, statLines: [{ stat: 'BIRDIES', value: 6 }] },
        { round: { id: 'r-2', sportEventRoundId: 'er-2', roundNumber: 2, status: 'IN_PROGRESS', completedAt: null }, golf: null, statLines: [] },
      ],
      raceResult: { finishPosition: 2, startPosition: 5, resultStatus: 'FINISHED', isOfficial: true, riderName: null },
      affiliatedWithSportLeague: false,
    } as unknown as SportEventParticipantView;

    const dto = mapSportEventParticipantToDto(view);

    expect(dto).toMatchObject({ isActive: false, inactiveReason: 'WITHDRAWN', ranking: 1, oddsToWin: 450, seedNumber: 3 });
    expect(dto.valuation).toEqual({ id: 'v-1', sportEventTierId: 'tier-a', tierOrderIndex: 0, tierAssignedSource: 'MANUAL', price: 12000, priceAssignedSource: 'UPLOAD' });
    expect(dto.standing).toEqual({
      id: 's-1',
      position: 1,
      displayPosition: 'T1',
      status: 'ACTIVE',
      asOf: '2026-04-12T20:00:00.000Z',
      currentRound: 4,
      golf: { eventScoreToPar: -12, eventStrokes: 276, currentRoundThru: 18 },
    });
    expect(dto.rounds).toEqual([
      { id: 'r-1', sportEventRoundId: 'er-1', roundNumber: 1, status: 'COMPLETE', completedAt: '2026-04-09T23:00:00.000Z', golf: { strokes: 68, scoreToPar: -4, thru: 18 }, statLines: [{ stat: 'BIRDIES', value: 6 }] },
      { id: 'r-2', sportEventRoundId: 'er-2', roundNumber: 2, status: 'IN_PROGRESS', completedAt: null, golf: null, statLines: [] },
    ]);
    expect(dto.race).toEqual({ finishPosition: 2, startPosition: 5, resultStatus: 'FINISHED', isOfficial: true, riderName: null });
  });

  it('gives a standing with no time and no golf detail a null as-of and null golf', () => {
    const dto = mapSportEventParticipantToDto({
      entry,
      participant: scottie,
      valuation: null,
      standing: { standing: { id: 's-1', position: null, displayPosition: null, status: 'ACTIVE', asOf: null, currentRound: null }, golf: null },
      rounds: [],
      raceResult: null,
      affiliatedWithSportLeague: true,
    } as unknown as SportEventParticipantView);

    expect(dto.standing).toMatchObject({ asOf: null, golf: null });
  });

  it('rolls a field upload\'s dry run up by how each row resolved, its duplicates, and what it would change', () => {
    const row = (overrides: Partial<FieldUploadPreviewRow>): FieldUploadPreviewRow => ({
      row: { rowNumber: 1 } as never,
      resolution: 'MATCHED',
      participantId: 'p-1',
      participantName: 'Player One',
      sportEventParticipantId: 'sep-1',
      rowError: null,
      change: 'UPDATE',
      before: null,
      after: null,
      message: null,
      ...overrides,
    });

    const dto = mapFieldUploadPreviewToDto([
      row({}),
      row({ change: 'UNCHANGED' }),
      row({ rowError: 'DUPLICATE_PARTICIPANT', change: null }),
      row({ resolution: 'UNRESOLVED', participantId: null, change: null }),
      row({ resolution: 'AMBIGUOUS', participantId: null, change: null }),
    ]);

    expect(dto.rollup).toEqual({ total: 5, matched: 3, unresolved: 1, ambiguous: 1, duplicate: 1, update: 1, unchanged: 1 });
    expect(dto.rows[0]).toEqual({ row: { rowNumber: 1 }, resolution: 'MATCHED', participantId: 'p-1', participantName: 'Player One', sportEventParticipantId: 'sep-1', rowError: null, change: 'UPDATE', before: null, after: null, message: null });
  });
});

describe('league membership and invitation mappers', () => {
  const user = { id: 'user-1', email: 'riley@example.test', username: 'riley', firstName: 'Riley', lastName: 'Quinn', isActive: true, createdAt: created } as User;

  it('shows a membership with its dates and the member as a user', () => {
    const dto = mapLeagueMembershipToDto({ id: 'm-1', leagueId: 'league-1', userId: 'user-1', role: 'MEMBER', status: 'ACTIVE', joinedAt: created, createdAt: created, updatedAt: updated } as never, user);

    expect(dto).toMatchObject({ id: 'm-1', role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', user: { id: 'user-1', isRootAdmin: false } });
  });

  const joinLink = {
    id: 'inv-1',
    leagueId: 'league-1',
    inviteCode: 'JOIN123',
    inviteType: 'LINK',
    status: 'PENDING',
    maxUses: 10,
    currentUses: 2,
    invitedBy: 'user-1',
    createdAt: created,
    updatedAt: updated,
  } as unknown as LeagueInvitation;

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
    const accepted = {
      ...joinLink,
      email: 'sam@example.test',
      inviteType: 'EMAIL',
      status: 'ACCEPTED',
      expiresAt: new Date('2026-03-01T00:00:00.000Z'),
      acceptedAt: new Date('2026-02-15T00:00:00.000Z'),
      acceptedBy: 'user-2',
    } as unknown as LeagueInvitation;

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
    contestFormat: ContestFormat.ROSTER,
    period: null,
    slot: null,
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
      contestFormat: ContestFormat.ROSTER,
      period: undefined,
      slot: undefined,
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
    expect(mapContestEntryPickRowToDomain({ ...row, period: 2, slot: 3, tier: 'A', cost: { toNumber: () => 12.5 }, lineupSlot: 1, pickSequence: 7 })).toMatchObject({
      period: 2,
      slot: 3,
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
