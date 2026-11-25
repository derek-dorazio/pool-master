import { testDomainEvents } from '../../support/domain-events';
import { expect } from '@jest/globals';
import { ParticipantService } from '../../../packages/core-api/src/modules/participants/service';
import { fakeParticipantProviderMappingRepo, fakeParticipantRepo } from '../../support/repo-fakes';
import { fakeLogger } from '../../support/fake-logger';

// ParticipantService's reads, its update, and how it reports a store failure on a write.

const PARTICIPANT = { id: 'participant-1', sportLeagueId: 'league-1', name: 'Scottie Scheffler' };

describe('ParticipantService reads', () => {
  it('reads a participant by id straight from the store', async () => {
    const participants = fakeParticipantRepo({ findById: jest.fn().mockResolvedValue(PARTICIPANT) });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), testDomainEvents());

    await expect(service.findById('participant-1')).resolves.toBe(PARTICIPANT);
  });

  it('searches with an empty query when none is given, so the filters alone narrow the list', async () => {
    const participants = fakeParticipantRepo({ search: jest.fn().mockResolvedValue([PARTICIPANT]) });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), testDomainEvents(), fakeLogger());

    await expect(service.search({ filters: { sportLeagueId: 'league-1' } })).resolves.toEqual([PARTICIPANT]);
    expect(participants.search).toHaveBeenCalledWith('', { sportLeagueId: 'league-1' });
  });

  it('lists a participant\'s provider mappings', async () => {
    const mapping = { participantId: 'participant-1', providerId: 'feed', externalId: 'ext-9' };
    const mappings = fakeParticipantProviderMappingRepo({ findByParticipant: jest.fn().mockResolvedValue([mapping]) });
    const service = new ParticipantService(fakeParticipantRepo(), mappings, testDomainEvents());

    await expect(service.getProviderMappings('participant-1')).resolves.toEqual([mapping]);
  });

  it('lists the feed ids one provider has mapped among one sport league\'s participants', async () => {
    const mapping = { participantId: 'participant-1', providerId: 'feed', externalId: 'ext-9' };
    const mappings = fakeParticipantProviderMappingRepo({ findByProviderAndSportLeague: jest.fn().mockResolvedValue([mapping]) });
    const service = new ParticipantService(fakeParticipantRepo(), mappings, testDomainEvents(), fakeLogger());

    await expect(service.listSportLeagueProviderMappings('feed', 'league-1')).resolves.toEqual([mapping]);
    expect(mappings.findByProviderAndSportLeague).toHaveBeenCalledWith('feed', 'league-1');
  });
});

describe('ParticipantService writes', () => {
  it('updates an existing participant with exactly the fields given', async () => {
    const participants = fakeParticipantRepo({
      findById: jest.fn().mockResolvedValue(PARTICIPANT),
      update: jest.fn().mockResolvedValue({ ...PARTICIPANT, name: 'S. Scheffler' }),
    });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), testDomainEvents(), fakeLogger());

    await expect(service.update('participant-1', { name: 'S. Scheffler' })).resolves.toMatchObject({ name: 'S. Scheffler' });
    expect(participants.update).toHaveBeenCalledWith('participant-1', { name: 'S. Scheffler' });
  });

  it('logs and rethrows a store failure on update rather than reporting success', async () => {
    const logger = fakeLogger();
    const participants = fakeParticipantRepo({
      findById: jest.fn().mockResolvedValue(PARTICIPANT),
      update: jest.fn().mockRejectedValue(new Error('constraint violated')),
    });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), testDomainEvents(), logger);

    await expect(service.update('participant-1', { name: 'x' })).rejects.toThrow('constraint violated');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'participants.update.failed' }), expect.any(String));
  });

  it('logs and rethrows a store failure on create rather than reporting success', async () => {
    const logger = fakeLogger();
    const participants = fakeParticipantRepo({ create: jest.fn().mockRejectedValue(new Error('duplicate')) });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), testDomainEvents(), logger);

    await expect(service.create({ sportLeagueId: 'league-1', name: 'x', participantType: 'INDIVIDUAL' }))
      .rejects.toThrow('duplicate');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'participants.create.failed' }), expect.any(String));
  });
});

describe('ParticipantService delete (#1400)', () => {
  it('deletes a participant no event field holds', async () => {
    const participants = fakeParticipantRepo();
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), testDomainEvents(), fakeLogger());

    await expect(service.delete('participant-1')).resolves.toBeUndefined();

    expect(participants.deleteUnlessOnAField).toHaveBeenCalledWith('participant-1');
  });

  it('refuses with 409 PARTICIPANT_IN_USE when the locked count finds them on an event field', async () => {
    const participants = fakeParticipantRepo({ deleteUnlessOnAField: jest.fn().mockResolvedValue(2) });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), testDomainEvents(), fakeLogger());

    await expect(service.delete('participant-1')).rejects.toMatchObject({ code: 'PARTICIPANT_IN_USE', statusCode: 409 });
  });

  it('answers 404 PARTICIPANT_NOT_FOUND for an unknown participant', async () => {
    const participants = fakeParticipantRepo({ deleteUnlessOnAField: jest.fn().mockResolvedValue(null) });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), testDomainEvents(), fakeLogger());

    await expect(service.delete('participant-9')).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_FOUND', statusCode: 404 });
  });
});

// #2096 — a provider-synced league takes a participant with its sync provider's feed id, written
// with the mapping, or a test participant; nothing else, since the sync would make a duplicate.
describe('ParticipantService create in a provider-synced sport league (#2096)', () => {
  const SYNC_PROVIDER_ROW_ID = 'provider-row-balldontlie';
  const NEW_PLAYER = { sportLeagueId: 'league-1', name: 'Avery Hart', participantType: 'INDIVIDUAL' as const };

  function syncedService(syncProviderId: string | null = SYNC_PROVIDER_ROW_ID) {
    const participants = fakeParticipantRepo();
    const mappings = fakeParticipantProviderMappingRepo({ findSyncProviderId: jest.fn().mockResolvedValue(syncProviderId) });
    return { service: new ParticipantService(participants, mappings, testDomainEvents(), fakeLogger()), participants };
  }

  it('refuses a participant with no feed id with 409 PARTICIPANT_FEED_ID_REQUIRED, writing nothing', async () => {
    const { service, participants } = syncedService();

    await expect(service.create(NEW_PLAYER)).rejects.toMatchObject({ code: 'PARTICIPANT_FEED_ID_REQUIRED', statusCode: 409 });
    expect(participants.create).not.toHaveBeenCalled();
    expect(participants.createWithProviderMapping).not.toHaveBeenCalled();
  });

  it('writes a participant given the sync provider\'s feed id together with its mapping at that provider, and the job that resolves its unmapped finding', async () => {
    const { service, participants } = syncedService();

    await service.create({ ...NEW_PLAYER, feedId: 'player-41' });

    expect(participants.create).not.toHaveBeenCalled();
    expect(participants.createWithProviderMapping).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Avery Hart', isTestData: false }),
      { providerId: SYNC_PROVIDER_ROW_ID, externalId: 'player-41' },
      [expect.objectContaining({ type: 'RESOLVE_MAPPED_PARTICIPANT_FINDINGS', payload: { sportLeagueId: 'league-1', providerId: SYNC_PROVIDER_ROW_ID, externalIds: ['player-41'] } })],
    );
  });

  it('refuses a feed id another participant of the league already holds with 409 PARTICIPANT_FEED_ID_TAKEN', async () => {
    const { service, participants } = syncedService();
    (participants.createWithProviderMapping as jest.Mock).mockResolvedValue(null);

    await expect(service.create({ ...NEW_PLAYER, feedId: 'player-41' })).rejects.toMatchObject({ code: 'PARTICIPANT_FEED_ID_TAKEN', statusCode: 409 });
  });

  it('writes a test participant with no feed id and no mapping', async () => {
    const { service, participants } = syncedService();

    await service.create({ ...NEW_PLAYER, isTestData: true });

    expect(participants.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Avery Hart', isTestData: true }));
    expect(participants.createWithProviderMapping).not.toHaveBeenCalled();
  });

  it('refuses a test participant given a feed id with 422 TEST_PARTICIPANT_FEED_ID, before reading the league', async () => {
    const { service, participants } = syncedService();

    await expect(service.create({ ...NEW_PLAYER, isTestData: true, feedId: 'player-41' })).rejects.toMatchObject({ code: 'TEST_PARTICIPANT_FEED_ID', statusCode: 422 });
    expect(participants.create).not.toHaveBeenCalled();
  });

  it('takes a participant with no feed id in a league with no feed, as before, and refuses a feed id there with 422 SPORT_LEAGUE_NOT_SYNCED', async () => {
    const { service, participants } = syncedService(null);

    await service.create(NEW_PLAYER);
    await expect(service.create({ ...NEW_PLAYER, feedId: 'player-41' })).rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_SYNCED', statusCode: 422 });

    expect(participants.create).toHaveBeenCalledTimes(1);
    expect(participants.create).toHaveBeenCalledWith(expect.objectContaining({ isTestData: false }));
  });

  it('answers 404 SPORT_LEAGUE_NOT_FOUND for a sport league that does not exist', async () => {
    const mappings = fakeParticipantProviderMappingRepo({ findSyncProviderId: jest.fn().mockResolvedValue(undefined) });
    const service = new ParticipantService(fakeParticipantRepo(), mappings, testDomainEvents(), fakeLogger());

    await expect(service.create(NEW_PLAYER)).rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
  });

  it('refuses to bind a feed id to a test participant with 422 TEST_PARTICIPANT_FEED_ID, binding nothing', async () => {
    const participants = fakeParticipantRepo({ findById: jest.fn().mockResolvedValue({ ...PARTICIPANT, isTestData: true }) });
    const mappings = fakeParticipantProviderMappingRepo();
    const service = new ParticipantService(participants, mappings, testDomainEvents(), fakeLogger());

    await expect(service.bindProviderMapping('participant-1', SYNC_PROVIDER_ROW_ID, 'player-41')).rejects.toMatchObject({ code: 'TEST_PARTICIPANT_FEED_ID', statusCode: 422 });
    expect(mappings.bind).not.toHaveBeenCalled();
  });
});
