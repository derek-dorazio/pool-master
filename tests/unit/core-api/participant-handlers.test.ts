/**
 * The participant route handlers (#1482), called with a stand-in service and provider registry:
 * the filters a list needs, the 404s for a missing participant or provider, and that an error the
 * handler does not own reaches the global error handler unchanged.
 */
import { expect } from '@jest/globals';
import { InjuryStatusCode, ParticipantStatus } from '@poolmaster/shared/domain';
import type { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import { createParticipantHandlers } from '../../../packages/core-api/src/modules/participants/handler';
import { ParticipantNotFoundError, type ParticipantService } from '../../../packages/core-api/src/modules/participants/service';
import { callHandler, stubRequest } from '../../support/handler-call';

const AT = new Date('2026-04-10T12:00:00.000Z');
const boom = new Error('database down');
const participant = {
  id: 'p1',
  sportId: 'golf',
  name: 'Scottie Scheffler',
  participantType: 'INDIVIDUAL',
  status: ParticipantStatus.ACTIVE,
  injuryStatus: { status: InjuryStatusCode.HEALTHY },
  externalIds: {},
  createdAt: AT,
  updatedAt: AT,
};
const mapping = { id: 'm1', participantId: 'p1', providerId: 'feed', externalId: 'x1', confidence: 'EXACT', mappedAt: AT };

function service(overrides: Record<string, unknown> = {}) {
  return {
    search: jest.fn((..._args: unknown[]) => Promise.resolve([participant])),
    findById: jest.fn((id: string) => Promise.resolve(id === 'p1' ? participant : null)),
    getProviderMappings: jest.fn((..._args: unknown[]) => Promise.resolve([mapping])),
    delete: jest.fn((..._args: unknown[]) => Promise.resolve()),
    bindProviderMapping: jest.fn((..._args: unknown[]) => Promise.resolve(mapping)),
    create: jest.fn((..._args: unknown[]) => Promise.resolve(participant)),
    update: jest.fn((..._args: unknown[]) => Promise.resolve(participant)),
    ...overrides,
  };
}
const registry = { getProviderById: (id: string) => (id === 'feed' ? {} : undefined) } as unknown as ProviderRegistry;
const handlersOver = (fake: ReturnType<typeof service>) => createParticipantHandlers(fake as unknown as ParticipantService, registry);

describe('participant search', () => {
  it('refuses a list with neither a sport nor a long enough search term with 400 SEARCH_TERM_REQUIRED', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).searchParticipants, stubRequest({ query: { q: 'a' } }));

    expect(reply).toMatchObject({ statusCode: 400, body: { error: { code: 'SEARCH_TERM_REQUIRED' } } });
    expect(fake.search).not.toHaveBeenCalled();
  });

  it('searches a sport\'s catalog by its trimmed term and status', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).searchParticipants, stubRequest({ query: { q: '  scottie ', sportId: 'golf', status: ParticipantStatus.ACTIVE } }));

    expect(fake.search).toHaveBeenCalledWith({ query: 'scottie', filters: { sportId: 'golf', status: ParticipantStatus.ACTIVE } });
    expect(reply.body).toMatchObject({ participants: [{ id: 'p1' }] });
  });

  it('searches every sport by a long enough term alone', async () => {
    const fake = service();

    await callHandler(handlersOver(fake).searchParticipants, stubRequest({ query: { q: 'scottie' } }));

    expect(fake.search).toHaveBeenCalledWith({ query: 'scottie', filters: { sportId: undefined, status: undefined } });
  });
});

describe('participant provider mappings', () => {
  it('lists a participant\'s mappings, and answers a missing participant with 404 PARTICIPANT_NOT_FOUND', async () => {
    const handlers = handlersOver(service());

    const found = await callHandler(handlers.listProviderMappings, stubRequest({ params: { id: 'p1' } }));
    const missing = await callHandler(handlers.listProviderMappings, stubRequest({ params: { id: 'nope' } }));

    expect(found.body).toMatchObject({ providerMappings: [{ providerId: 'feed', externalId: 'x1' }] });
    expect(missing).toMatchObject({ statusCode: 404, body: { error: { code: 'PARTICIPANT_NOT_FOUND' } } });
  });

  it('binds a mapping to a registered provider', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).bindProviderMapping, stubRequest({ params: { id: 'p1' }, body: { providerId: 'feed', externalId: 'x1' } }));

    expect(fake.bindProviderMapping).toHaveBeenCalledWith('p1', 'feed', 'x1');
    expect(reply.body).toMatchObject({ providerMapping: { providerId: 'feed' } });
  });

  it('refuses a mapping to a provider that is not registered with 404 PROVIDER_NOT_FOUND and binds nothing', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).bindProviderMapping, stubRequest({ params: { id: 'p1' }, body: { providerId: 'gone', externalId: 'x1' } }));

    expect(reply).toMatchObject({ statusCode: 404, body: { error: { code: 'PROVIDER_NOT_FOUND' } } });
    expect(fake.bindProviderMapping).not.toHaveBeenCalled();
  });

  it('answers binding to a missing participant with 404, and passes any other failure on', async () => {
    const request = () => stubRequest({ params: { id: 'p1' }, body: { providerId: 'feed', externalId: 'x1' } });
    const missing = handlersOver(service({ bindProviderMapping: () => Promise.reject(new ParticipantNotFoundError('p1')) }));
    const broken = handlersOver(service({ bindProviderMapping: () => Promise.reject(boom) }));

    expect(await callHandler(missing.bindProviderMapping, request())).toMatchObject({ statusCode: 404, body: { error: { code: 'PARTICIPANT_NOT_FOUND' } } });
    await expect(callHandler(broken.bindProviderMapping, request())).rejects.toBe(boom);
  });
});

describe('participant detail, create, update and delete', () => {
  it('answers a participant, and a missing one with 404 PARTICIPANT_NOT_FOUND', async () => {
    const handlers = handlersOver(service());

    const found = await callHandler(handlers.getParticipant, stubRequest({ params: { id: 'p1' }, contextLogger: false }));
    const missing = await callHandler(handlers.getParticipant, stubRequest({ params: { id: 'nope' } }));

    expect(found.body).toMatchObject({ participant: { id: 'p1' } });
    expect(missing).toMatchObject({ statusCode: 404, body: { error: { code: 'PARTICIPANT_NOT_FOUND' } } });
  });

  it('passes a failure reading a participant on to the global error handler', async () => {
    const handlers = handlersOver(service({ findById: () => Promise.reject(boom) }));

    await expect(callHandler(handlers.getParticipant, stubRequest({ params: { id: 'p1' } }))).rejects.toBe(boom);
  });

  it('creates a participant from the body\'s fields with 201', async () => {
    const fake = service();
    const body = { sportId: 'golf', name: 'Scottie Scheffler', participantType: 'INDIVIDUAL', firstName: 'Scottie', externalIds: { feed: 'x1' } };

    const reply = await callHandler(handlersOver(fake).createParticipant, stubRequest({ body, contextLogger: false }));

    expect(fake.create).toHaveBeenCalledWith(expect.objectContaining({ sportId: 'golf', name: 'Scottie Scheffler', firstName: 'Scottie', externalIds: { feed: 'x1' } }));
    expect(reply).toMatchObject({ statusCode: 201, body: { participant: { id: 'p1' } } });
  });

  it('passes a failure creating a participant on to the global error handler', async () => {
    const handlers = handlersOver(service({ create: () => Promise.reject(boom) }));

    await expect(callHandler(handlers.createParticipant, stubRequest({ body: { sportId: 'golf', name: 'X', participantType: 'INDIVIDUAL' } }))).rejects.toBe(boom);
  });

  it('updates a participant, and answers a missing one with 404 PARTICIPANT_NOT_FOUND', async () => {
    const request = (contextLogger?: false) => stubRequest({ params: { id: 'p1' }, body: { name: 'Scottie' }, contextLogger });
    const updated = await callHandler(handlersOver(service()).updateParticipant, request(false));
    const missing = await callHandler(handlersOver(service({ update: () => Promise.reject(new ParticipantNotFoundError('p1')) })).updateParticipant, request());

    expect(updated.body).toMatchObject({ participant: { id: 'p1' } });
    expect(missing).toMatchObject({ statusCode: 404, body: { error: { code: 'PARTICIPANT_NOT_FOUND' } } });
  });

  it('passes any other failure updating a participant on to the global error handler', async () => {
    const handlers = handlersOver(service({ update: () => Promise.reject(boom) }));

    await expect(callHandler(handlers.updateParticipant, stubRequest({ params: { id: 'p1' }, body: { name: 'X' } }))).rejects.toBe(boom);
  });

  it('deletes a participant with 204', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).deleteParticipant, stubRequest({ params: { id: 'p1' } }));

    expect(fake.delete).toHaveBeenCalledWith('p1');
    expect(reply.statusCode).toBe(204);
  });
});
