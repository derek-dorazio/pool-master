import { expect } from '@jest/globals';
import { ParticipantService } from '../../../packages/core-api/src/modules/participants/service';
import { fakeParticipantProviderMappingRepo, fakeParticipantRepo } from '../../support/repo-fakes';
import { fakeLogger } from '../../support/fake-logger';

// ParticipantService's reads, its update, and how it reports a store failure on a write.

const PARTICIPANT = { id: 'participant-1', sportId: 'sport-1', name: 'Scottie Scheffler' };

describe('ParticipantService reads', () => {
  it('reads a participant by id and the participants of a sport straight from the store', async () => {
    const participants = fakeParticipantRepo({
      findById: jest.fn().mockResolvedValue(PARTICIPANT),
      findBySport: jest.fn().mockResolvedValue([PARTICIPANT]),
    });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo());

    await expect(service.findById('participant-1')).resolves.toBe(PARTICIPANT);
    await expect(service.findBySport('sport-1')).resolves.toEqual([PARTICIPANT]);
    expect(participants.findBySport).toHaveBeenCalledWith('sport-1');
  });

  it('searches with an empty query when none is given, so the filters alone narrow the list', async () => {
    const participants = fakeParticipantRepo({ search: jest.fn().mockResolvedValue([PARTICIPANT]) });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), fakeLogger());

    await expect(service.search({ filters: { sportId: 'sport-1' } })).resolves.toEqual([PARTICIPANT]);
    expect(participants.search).toHaveBeenCalledWith('', { sportId: 'sport-1' });
  });

  it('finds a participant by a provider identity through its provider mapping, and lists a participant\'s mappings', async () => {
    const mapping = { participantId: 'participant-1', providerId: 'feed', externalId: 'ext-9' };
    const participants = fakeParticipantRepo({ findByExternalId: jest.fn().mockResolvedValue(PARTICIPANT) });
    const mappings = fakeParticipantProviderMappingRepo({ findByParticipant: jest.fn().mockResolvedValue([mapping]) });
    const service = new ParticipantService(participants, mappings);

    await expect(service.findByProvider('feed', 'ext-9')).resolves.toBe(PARTICIPANT);
    expect(participants.findByExternalId).toHaveBeenCalledWith('feed', 'ext-9');
    await expect(service.getProviderMappings('participant-1')).resolves.toEqual([mapping]);
  });
});

describe('ParticipantService writes', () => {
  it('updates an existing participant with exactly the fields given', async () => {
    const participants = fakeParticipantRepo({
      findById: jest.fn().mockResolvedValue(PARTICIPANT),
      update: jest.fn().mockResolvedValue({ ...PARTICIPANT, name: 'S. Scheffler' }),
    });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), fakeLogger());

    await expect(service.update('participant-1', { name: 'S. Scheffler' })).resolves.toMatchObject({ name: 'S. Scheffler' });
    expect(participants.update).toHaveBeenCalledWith('participant-1', { name: 'S. Scheffler' });
  });

  it('logs and rethrows a store failure on update rather than reporting success', async () => {
    const logger = fakeLogger();
    const participants = fakeParticipantRepo({
      findById: jest.fn().mockResolvedValue(PARTICIPANT),
      update: jest.fn().mockRejectedValue(new Error('constraint violated')),
    });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), logger);

    await expect(service.update('participant-1', { name: 'x' })).rejects.toThrow('constraint violated');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'participants.update.failed' }), expect.any(String));
  });

  it('logs and rethrows a store failure on create rather than reporting success', async () => {
    const logger = fakeLogger();
    const participants = fakeParticipantRepo({ create: jest.fn().mockRejectedValue(new Error('duplicate')) });
    const service = new ParticipantService(participants, fakeParticipantProviderMappingRepo(), logger);

    await expect(service.create({ sportId: 'sport-1', name: 'x', participantType: 'INDIVIDUAL', externalId: 'e' }))
      .rejects.toThrow('duplicate');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'participants.create.failed' }), expect.any(String));
  });
});
