/**
 * Unit tests for the golf tournament CRUD/transition admin handlers added in
 * pool-master-ij2 (plans/124 §4.3/§5.2): adminListGolfTournaments,
 * adminCreateGolfTournament, adminGetGolfTournament, adminUpdateGolfTournament,
 * adminDeleteGolfTournament, adminTransitionGolfTournament.
 */
import { createGolfAdminHandlers } from '../../../packages/core-api/src/modules/admin/golf/handler';
import { GolfTournamentError } from '../../../packages/core-api/src/modules/golf/golf-tournament-service';
import { EventLifecycleError } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { EventScoreSourceError } from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { SportCatalogError } from '../../../packages/core-api/src/modules/sport-catalog/errors';

function buildReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function buildTournamentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    providerId: 'manual-admin',
    externalId: 'manual-abc',
    name: 'The Masters',
    venue: null,
    location: null,
    startDate: new Date('2027-04-08T00:00:00.000Z'),
    endDate: null,
    status: 'SCHEDULED',
    rounds: 4,
    releaseAt: new Date('2027-04-01T00:00:00.000Z'),
    fieldLocksAt: new Date('2027-04-08T00:00:00.000Z'),
    fieldLocked: false,
    seasonId: 'season-1',
    leagueEventId: 'league-event-1',
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    createdAt: new Date('2027-01-01T00:00:00.000Z'),
    updatedAt: new Date('2027-01-01T00:00:00.000Z'),
    fieldCount: 0,
    tierCount: 6,
    contestCount: 0,
    ...overrides,
  };
}

function buildHandlers(services: Record<string, unknown> = {}) {
  const golfTournamentService = {
    listTournaments: jest.fn().mockResolvedValue([buildTournamentRow()]),
    createTournament: jest.fn().mockResolvedValue(buildTournamentRow()),
    getTournament: jest.fn().mockResolvedValue(buildTournamentRow()),
    updateTournament: jest.fn().mockResolvedValue(buildTournamentRow()),
    deleteTournament: jest.fn().mockResolvedValue(undefined),
    getAllowedTransitions: jest.fn().mockReturnValue(['IN_PROGRESS', 'POSTPONED', 'CANCELLED']),
    ...(services.golfTournamentService as object ?? {}),
  };
  const eventLifecycleService = {
    applySportEventStatusTransition: jest.fn().mockResolvedValue({}),
    ...(services.eventLifecycleService as object ?? {}),
  };
  const eventScoreSourceService = {
    linkScoreSource: jest.fn().mockResolvedValue(undefined),
    unlinkScoreSource: jest.fn().mockResolvedValue(undefined),
    ...(services.eventScoreSourceService as object ?? {}),
  };
  const handlers = createGolfAdminHandlers(
    {} as any,
    {} as any,
    {} as any,
    golfTournamentService as any,
    eventLifecycleService as any,
    {} as any,
    {} as any,
    eventScoreSourceService as any,
  );
  return { handlers, golfTournamentService, eventLifecycleService, eventScoreSourceService };
}

describe('pool-master-ij2 — golf admin tournament CRUD/transition handlers', () => {
  describe('listTournaments', () => {
    it('passes status/search query params through and returns the canonical DTO list', async () => {
      const { handlers, golfTournamentService } = buildHandlers();
      const reply = buildReply();

      await handlers.listTournaments({ query: { status: 'SCHEDULED', search: 'masters' } } as any, reply as any);

      expect(golfTournamentService.listTournaments).toHaveBeenCalledWith({ status: 'SCHEDULED', search: 'masters' });
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        tournaments: [expect.objectContaining({ id: 'event-1', name: 'The Masters' })],
      }));
    });
  });

  describe('createTournament', () => {
    it('parses date strings, creates the tournament, and returns 201 with the workflow block', async () => {
      const { handlers, golfTournamentService } = buildHandlers();
      const reply = buildReply();

      await handlers.createTournament({
        body: {
          name: 'The Masters',
          startDate: '2027-04-08T00:00:00.000Z',
          releaseAt: '2027-04-01T00:00:00.000Z',
          fieldLocksAt: '2027-04-08T00:00:00.000Z',
          seasonId: 'season-1',
          rounds: 4,
        },
      } as any, reply as any);

      expect(golfTournamentService.createTournament).toHaveBeenCalledWith(expect.objectContaining({
        name: 'The Masters',
        seasonId: 'season-1',
        startDate: new Date('2027-04-08T00:00:00.000Z'),
        releaseAt: new Date('2027-04-01T00:00:00.000Z'),
        fieldLocksAt: new Date('2027-04-08T00:00:00.000Z'),
      }));
      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        tournament: expect.objectContaining({
          id: 'event-1',
          workflow: { currentStatus: 'SCHEDULED', allowedTransitions: ['IN_PROGRESS', 'POSTPONED', 'CANCELLED'] },
        }),
      }));
    });

    it('maps a GolfTournamentError to its statusCode/code', async () => {
      const { handlers } = buildHandlers({
        golfTournamentService: {
          createTournament: jest.fn().mockRejectedValue(new GolfTournamentError('no golf season', 'SEASON_SPORT_MISMATCH', 422)),
        },
      });
      const reply = buildReply();

      await handlers.createTournament({
        body: { name: 'x', startDate: '2027-01-01T00:00:00.000Z', releaseAt: '2027-01-01T00:00:00.000Z', fieldLocksAt: '2027-01-01T00:00:00.000Z', seasonId: 'bad-season' },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(422);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'SEASON_SPORT_MISMATCH' }),
      }));
    });

    it('maps a SportCatalogError (from season validation) to its statusCode/code too', async () => {
      const { handlers } = buildHandlers({
        golfTournamentService: {
          createTournament: jest.fn().mockRejectedValue(new SportCatalogError('season not found', 'SEASON_NOT_FOUND', 404)),
        },
      });
      const reply = buildReply();

      await handlers.createTournament({
        body: { name: 'x', startDate: '2027-01-01T00:00:00.000Z', releaseAt: '2027-01-01T00:00:00.000Z', fieldLocksAt: '2027-01-01T00:00:00.000Z', seasonId: 'missing' },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'SEASON_NOT_FOUND' }),
      }));
    });
  });

  describe('getTournament', () => {
    it('returns the tournament with its workflow block', async () => {
      const { handlers, golfTournamentService } = buildHandlers();
      const reply = buildReply();

      await handlers.getTournament({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(golfTournamentService.getTournament).toHaveBeenCalledWith('event-1');
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        tournament: expect.objectContaining({ id: 'event-1' }),
      }));
    });

    it('pool-master-753 derives scoreSource=null when providerId is the manual-admin placeholder', async () => {
      const { handlers } = buildHandlers({
        golfTournamentService: {
          getTournament: jest.fn().mockResolvedValue(buildTournamentRow({ providerId: 'manual-admin' })),
        },
      });
      const reply = buildReply();

      await handlers.getTournament({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        tournament: expect.objectContaining({ source: 'MANUAL', scoreSource: null }),
      }));
    });

    it('pool-master-753 derives scoreSource={providerId, externalId} once linked to a real provider', async () => {
      const { handlers } = buildHandlers({
        golfTournamentService: {
          getTournament: jest.fn().mockResolvedValue(
            buildTournamentRow({ providerId: 'mock-golf', externalId: 'ext-1' }),
          ),
        },
      });
      const reply = buildReply();

      await handlers.getTournament({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        tournament: expect.objectContaining({
          source: 'PROVIDER',
          scoreSource: { providerId: 'mock-golf', externalId: 'ext-1' },
        }),
      }));
    });

    it('404s EVENT_NOT_FOUND when the tournament does not exist', async () => {
      const { handlers } = buildHandlers({
        golfTournamentService: { getTournament: jest.fn().mockResolvedValue(null) },
      });
      const reply = buildReply();

      await handlers.getTournament({ params: { eventId: 'missing' } } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'EVENT_NOT_FOUND' }),
      }));
    });
  });

  describe('updateTournament', () => {
    it('parses provided date strings and leaves the rest to the service partial update', async () => {
      const { handlers, golfTournamentService } = buildHandlers();
      const reply = buildReply();

      await handlers.updateTournament({
        params: { eventId: 'event-1' },
        body: { name: 'Renamed', fieldLocksAt: '2027-04-09T00:00:00.000Z' },
      } as any, reply as any);

      expect(golfTournamentService.updateTournament).toHaveBeenCalledWith('event-1', expect.objectContaining({
        name: 'Renamed',
        fieldLocksAt: new Date('2027-04-09T00:00:00.000Z'),
        startDate: undefined,
        endDate: undefined,
        releaseAt: undefined,
      }));
    });

    it('maps 409 EVENT_NOT_ADMIN_MANAGED from the service', async () => {
      const { handlers } = buildHandlers({
        golfTournamentService: {
          updateTournament: jest.fn().mockRejectedValue(new GolfTournamentError('provider-owned', 'EVENT_NOT_ADMIN_MANAGED', 409)),
        },
      });
      const reply = buildReply();

      await handlers.updateTournament({ params: { eventId: 'event-1' }, body: { name: 'x' } } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'EVENT_NOT_ADMIN_MANAGED' }),
      }));
    });
  });

  describe('deleteTournament', () => {
    it('deletes and returns 204', async () => {
      const { handlers, golfTournamentService } = buildHandlers();
      const reply = buildReply();

      await handlers.deleteTournament({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(golfTournamentService.deleteTournament).toHaveBeenCalledWith('event-1');
      expect(reply.status).toHaveBeenCalledWith(204);
    });

    it('maps 409 EVENT_HAS_CONTESTS from the service', async () => {
      const { handlers } = buildHandlers({
        golfTournamentService: {
          deleteTournament: jest.fn().mockRejectedValue(new GolfTournamentError('has contests', 'EVENT_HAS_CONTESTS', 409)),
        },
      });
      const reply = buildReply();

      await handlers.deleteTournament({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'EVENT_HAS_CONTESTS' }),
      }));
    });
  });

  describe('transitionTournament', () => {
    function buildRequest(overrides: Record<string, unknown> = {}) {
      return {
        params: { eventId: 'event-1' },
        body: { toStatus: 'IN_PROGRESS' },
        rootAdminContext: { rootAdminUser: { id: 'admin-1', email: 'admin@example.com' } },
        ...overrides,
      };
    }

    it('routes to EventLifecycleService.applySportEventStatusTransition with a ROOT_ADMIN actor from the request context', async () => {
      const { handlers, eventLifecycleService } = buildHandlers();
      const reply = buildReply();

      await handlers.transitionTournament(buildRequest() as any, reply as any);

      expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith({
        sportEventId: 'event-1',
        toStatus: 'IN_PROGRESS',
        actor: { type: 'ROOT_ADMIN', userId: 'admin-1', email: 'admin@example.com' },
      });
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        tournament: expect.objectContaining({ id: 'event-1' }),
      }));
    });

    it('maps 422 SPORT_EVENT_INVALID_TRANSITION from EventLifecycleError', async () => {
      const { handlers } = buildHandlers({
        eventLifecycleService: {
          applySportEventStatusTransition: jest.fn().mockRejectedValue(
            new EventLifecycleError('bad transition'),
          ),
        },
      });
      const reply = buildReply();

      await handlers.transitionTournament(buildRequest({ body: { toStatus: 'COMPLETED' } }) as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(422);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'SPORT_EVENT_INVALID_TRANSITION' }),
      }));
    });

    it('throws when no root admin context is present on the request', async () => {
      const { handlers } = buildHandlers();
      const reply = buildReply();

      await expect(
        handlers.transitionTournament(buildRequest({ rootAdminContext: undefined }) as any, reply as any),
      ).rejects.toThrow('Root admin context is required');
    });
  });

  describe('linkTournamentScoreSource', () => {
    it('pool-master-753 links the score source and returns the reloaded tournament with its workflow block', async () => {
      const { handlers, eventScoreSourceService, golfTournamentService } = buildHandlers();
      const reply = buildReply();

      await handlers.linkTournamentScoreSource({
        params: { eventId: 'event-1' },
        body: { providerId: 'mock-golf', externalId: 'ext-1' },
      } as any, reply as any);

      expect(eventScoreSourceService.linkScoreSource).toHaveBeenCalledWith('event-1', {
        providerId: 'mock-golf',
        externalId: 'ext-1',
      });
      expect(golfTournamentService.getTournament).toHaveBeenCalledWith('event-1');
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        tournament: expect.objectContaining({ id: 'event-1' }),
      }));
    });

    it('pool-master-753 maps 409 EXTERNAL_EVENT_ALREADY_LINKED from the service', async () => {
      const { handlers } = buildHandlers({
        eventScoreSourceService: {
          linkScoreSource: jest.fn().mockRejectedValue(
            new EventScoreSourceError('already linked', 'EXTERNAL_EVENT_ALREADY_LINKED', 409),
          ),
        },
      });
      const reply = buildReply();

      await handlers.linkTournamentScoreSource({
        params: { eventId: 'event-1' },
        body: { providerId: 'mock-golf', externalId: 'ext-1' },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'EXTERNAL_EVENT_ALREADY_LINKED' }),
      }));
    });

    it('pool-master-753 404s EVENT_NOT_FOUND when the tournament disappears before the reload', async () => {
      const { handlers } = buildHandlers({
        golfTournamentService: { getTournament: jest.fn().mockResolvedValue(null) },
      });
      const reply = buildReply();

      await handlers.linkTournamentScoreSource({
        params: { eventId: 'event-1' },
        body: { providerId: 'mock-golf', externalId: 'ext-1' },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'EVENT_NOT_FOUND' }),
      }));
    });
  });

  describe('unlinkTournamentScoreSource', () => {
    it('pool-master-753 unlinks the score source and returns the reloaded tournament', async () => {
      const { handlers, eventScoreSourceService, golfTournamentService } = buildHandlers();
      const reply = buildReply();

      await handlers.unlinkTournamentScoreSource({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(eventScoreSourceService.unlinkScoreSource).toHaveBeenCalledWith('event-1');
      expect(golfTournamentService.getTournament).toHaveBeenCalledWith('event-1');
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        tournament: expect.objectContaining({ id: 'event-1' }),
      }));
    });

    it('pool-master-753 maps 409 EVENT_NOT_ADMIN_MANAGED from the service', async () => {
      const { handlers } = buildHandlers({
        eventScoreSourceService: {
          unlinkScoreSource: jest.fn().mockRejectedValue(
            new EventScoreSourceError('provider-owned', 'EVENT_NOT_ADMIN_MANAGED', 409),
          ),
        },
      });
      const reply = buildReply();

      await handlers.unlinkTournamentScoreSource({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'EVENT_NOT_ADMIN_MANAGED' }),
      }));
    });
  });
});
