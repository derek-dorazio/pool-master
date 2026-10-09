import {
  ContestStatus,
  LeagueRole,
  SPORT_EVENT_STATUS_TRANSITIONS,
  SportEventStatus,
  SquadMembershipStatus,
  type SportEvent,
} from '@poolmaster/shared/domain';
import {
  EventLifecycleError,
  EventLifecycleService,
  type EventLifecycleContestDeps,
} from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { buildContest, buildLeague, buildMembership, buildUser } from '../../factories';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import {
  fakeContestEntryRepo,
  fakeContestRepo,
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
  fakeSquadMembershipRepo,
  fakeUserRepo,
} from '../../support/repo-fakes';
import { fakeLogger } from '../../support/fake-logger';
import { mockFn } from '../../support/mock-fn';
import type { MailDeliveryProvider } from '../../../packages/core-api/src/modules/email/mail-delivery';

const STARTED_EVENT_START = new Date('2026-05-02T20:00:00.000Z');

const USERS = [
  buildUser({
    id: 'commissioner-1',
    email: 'commissioner@example.com',
    firstName: 'Chris',
    lastName: 'Commissioner',
    username: 'commissioner',
  }),
  buildUser({
    id: 'member-1',
    email: 'member@example.com',
    firstName: 'Mia',
    lastName: 'Member',
    username: 'member',
  }),
];

/**
 * The contest ports, empty by default. `startedContest` adds one OPEN contest on the event, in a
 * league with one commissioner and one entry whose squad has one member; `transitioned` is
 * whether the guarded write finds it still startable.
 */
function contestDeps(options: { startedContest?: boolean; transitioned?: boolean } = {}): EventLifecycleContestDeps {
  const contest = buildContest({
    id: 'contest-1',
    leagueId: 'league-1',
    sportEventId: 'sport-event-1',
    name: 'Masters Pick 6',
    status: ContestStatus.OPEN,
  });
  return {
    contests: fakeContestRepo({
      findBySportEvent: jest.fn().mockResolvedValue(options.startedContest ? [contest] : []),
      transitionStatus: jest.fn().mockResolvedValue(options.transitioned ?? true),
    }),
    entries: fakeContestEntryRepo({
      findByContestWithSquad: jest.fn().mockResolvedValue([{
        id: 'entry-1',
        contestId: 'contest-1',
        squadId: 'squad-1',
        entryNumber: 1,
        name: 'Entry 1',
        status: 'ACTIVE',
        createdAt: new Date('2026-05-01'),
        updatedAt: new Date('2026-05-01'),
        squadName: 'Derek Team',
      }]),
    }),
    leagues: fakeLeagueRepo({
      findById: jest.fn().mockResolvedValue(buildLeague({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS' })),
    }),
    memberships: fakeLeagueMembershipRepo({
      findByLeague: jest.fn().mockResolvedValue([
        buildMembership({ leagueId: 'league-1', userId: 'commissioner-1', role: LeagueRole.COMMISSIONER }),
        buildMembership({ leagueId: 'league-1', userId: 'member-1', role: LeagueRole.MEMBER }),
      ]),
    }),
    squadMemberships: fakeSquadMembershipRepo({
      findBySquad: jest.fn().mockResolvedValue([{
        id: 'squad-membership-1',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'member-1',
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date('2026-05-01'),
        createdAt: new Date('2026-05-01'),
        updatedAt: new Date('2026-05-01'),
      }]),
    }),
    users: fakeUserRepo({
      findById: jest.fn().mockImplementation(async (id: string) => USERS.find((user) => user.id === id) ?? null),
    }),
  };
}

/** An in-memory store holding the one event under test, and the port over it. */
function seededEvents(overrides: Partial<SportEvent> = {}) {
  const store = new InMemorySportEvents();
  store.addEvent({
    id: 'sport-event-1',
    providerId: 'mock-contest-feed',
    externalId: 'provider-event-1',
    name: 'Manual Test Golf Tournament',
    startDate: new Date('2026-05-02T20:00:00.000Z'),
    status: SportEventStatus.SCHEDULED,
    ...overrides,
  });
  return { sportEvents: store.sportEventRepo(), storedEvent: () => store.events[0] };
}

describe('SPORT_EVENT_STATUS_TRANSITIONS exhaustiveness', () => {
  it('pool-master-g1z declares a row for every SportEventStatus value', () => {
    // Compile-time exhaustiveness comes from the `satisfies` clause on the
    // const itself; this is the runtime companion proving no key was silently
    // dropped by an edit that also touched the type.
    expect(Object.keys(SPORT_EVENT_STATUS_TRANSITIONS).sort()).toEqual(
      Object.values(SportEventStatus).sort(),
    );
  });
});

describe('SPORT_EVENT_STATUS_TRANSITIONS DRAFT row (#431)', () => {
  it('lets a draft move only to SCHEDULED (its release) or CANCELLED', () => {
    expect(SPORT_EVENT_STATUS_TRANSITIONS[SportEventStatus.DRAFT]).toEqual([
      SportEventStatus.SCHEDULED,
      SportEventStatus.CANCELLED,
    ]);
  });

  it('gives no status a way back to DRAFT', () => {
    for (const targets of Object.values(SPORT_EVENT_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(SportEventStatus.DRAFT);
    }
  });
});

describe('EventLifecycleService release guard (#431)', () => {
  it('refuses to move a draft to SCHEDULED outside the release action, with 409 SPORT_EVENT_RELEASE_REQUIRED', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.DRAFT });
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger());

    for (const actor of [{ type: 'ROOT_ADMIN' as const }, { type: 'SYSTEM' as const }]) {
      await expect(
        service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.SCHEDULED, actor }),
      ).rejects.toMatchObject({ code: 'SPORT_EVENT_RELEASE_REQUIRED', statusCode: 409 });
    }
    expect(storedEvent().status).toBe(SportEventStatus.DRAFT);
  });

  it('moves a draft to SCHEDULED when the release action asks', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.DRAFT });
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger());

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.SCHEDULED,
      actor: { type: 'ROOT_ADMIN' },
      release: true,
    });

    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });

  it('refuses to start a draft that was never released (422 SPORT_EVENT_INVALID_TRANSITION)', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.DRAFT });
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger());

    await expect(
      service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' } }),
    ).rejects.toMatchObject({ code: 'SPORT_EVENT_INVALID_TRANSITION', statusCode: 422 });
    expect(storedEvent().status).toBe(SportEventStatus.DRAFT);
  });
});

describe('EventLifecycleService.applySportEventStatusTransition', () => {
  it('pool-master-g1z allows a declared transition for a ROOT_ADMIN actor', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    const result = await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'ROOT_ADMIN' },
    });

    expect(result.fromStatus).toBe(SportEventStatus.SCHEDULED);
    expect(result.toStatus).toBe(SportEventStatus.IN_PROGRESS);
    expect(storedEvent().status).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('pool-master-g1z rejects an undeclared transition for a ROOT_ADMIN actor with 422 SPORT_EVENT_INVALID_TRANSITION', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        // SCHEDULED -> COMPLETED skips IN_PROGRESS entirely; not declared.
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'ROOT_ADMIN' },
      }),
    ).rejects.toMatchObject({
      name: 'EventLifecycleError',
      code: 'SPORT_EVENT_INVALID_TRANSITION',
      statusCode: 422,
    });
    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });

  it('pool-master-g1z treats a same-status call as a no-op, never rejecting it', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.COMPLETED, endDate: new Date('2026-05-31T22:00:00.000Z') });
    const contests = contestDeps();
    const golfContestSettlement = { settleCompletedSportEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new EventLifecycleService(
      contests,
      sportEvents,
      fakeLogger(),
      undefined,
      'http://localhost:5173',
      golfContestSettlement,
    );

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'ROOT_ADMIN' },
      }),
    ).resolves.toMatchObject({ fromStatus: SportEventStatus.COMPLETED, toStatus: SportEventStatus.COMPLETED });
  });

  it('pool-master-g1z sets endDate on completion only when it is not already set', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.IN_PROGRESS });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'SYSTEM' },
    });

    expect(storedEvent().status).toBe(SportEventStatus.COMPLETED);
    expect(storedEvent().endDate).toBeInstanceOf(Date);
  });

  it('pool-master-g1z leaves an already-set endDate alone on completion', async () => {
    const existingEndDate = new Date('2026-05-31T22:00:00.000Z');
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.IN_PROGRESS, endDate: existingEndDate });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'SYSTEM' },
    });

    expect(storedEvent().status).toBe(SportEventStatus.COMPLETED);
    expect(storedEvent().endDate).toEqual(existingEndDate);
  });

  it('allows a declared transition for a SYSTEM actor, the lifecycle scheduler', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    const result = await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(result.toStatus).toBe(SportEventStatus.IN_PROGRESS);
    expect(storedEvent().status).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('pool-master-k6q rejects an undeclared transition for a SYSTEM actor with 422 SPORT_EVENT_INVALID_TRANSITION, same as ROOT_ADMIN', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'SYSTEM' },
      }),
    ).rejects.toMatchObject({
      name: 'EventLifecycleError',
      code: 'SPORT_EVENT_INVALID_TRANSITION',
      statusCode: 422,
    });
    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });

  // pool-master-eux.6 — relocated from ingestion-persistence.test.ts (that
  // module now only proves it delegates here, see
  // tests/unit/core-api/ingestion-persistence.test.ts).
  it('pool-master-eux.6 triggers Golf contest settlement from completed schedule events', async () => {
    const settlement = {
      settleCompletedSportEvent: jest.fn().mockResolvedValue({ contestsCompleted: 1 }),
    };
    const eventEndDate = new Date('2026-05-31T22:00:00.000Z');
    const { sportEvents } = seededEvents({ status: SportEventStatus.IN_PROGRESS, endDate: eventEndDate });
    const contests = contestDeps();
    const service = new EventLifecycleService(
      contests,
      sportEvents,
      fakeLogger(),
      undefined,
      'http://localhost:5173',
      settlement,
    );

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'SYSTEM' },
    });

    expect(settlement.settleCompletedSportEvent).toHaveBeenCalledWith('sport-event-1', {
      completedAt: eventEndDate,
    });
  });

  // pool-master-9ya — relocated from ingestion-persistence.test.ts.
  it('pool-master-9ya activates open contests and sends contest-started summary emails when an event starts', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps({ startedContest: true });
    const mailDelivery = {
      providerName: 'smtp' as const,
      send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail-1' })),
    };
    const service = new EventLifecycleService(
      contests,
      sportEvents,
      fakeLogger(),
      mailDelivery,
      'https://app.primetimecommissioner.com',
    );

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(contests.contests.findBySportEvent).toHaveBeenCalledWith('sport-event-1', {
      statuses: [ContestStatus.OPEN],
    });
    expect(contests.contests.transitionStatus).toHaveBeenCalledWith('contest-1', {
      from: [ContestStatus.OPEN],
      to: ContestStatus.ACTIVE,
      startsAt: STARTED_EVENT_START,
    });
    expect(mailDelivery.send).toHaveBeenCalledTimes(2);
    expect(mailDelivery.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'commissioner@example.com',
      subject: 'Masters Pick 6 has started',
      metadata: {
        templateKey: 'CONTEST_STARTED_SUMMARY',
        leagueId: 'league-1',
        contestId: 'contest-1',
      },
    }));
    const memberMessage = mailDelivery.send.mock.calls.find(
      ([message]) => message.to === 'member@example.com',
    )?.[0];
    expect(memberMessage?.text).toContain('Manual Test Golf Tournament');
    expect(memberMessage?.text).toContain('Entries: 1');
    expect(memberMessage?.text).toContain('- Entry 1: Derek Team');
    expect(memberMessage?.text).toContain(
      'Open contest board: https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1',
    );
    expect(memberMessage?.html).toContain('Prime Time Commissioner');
  });

  it('pool-master-9ya does not resend contest-started email when the contest is already active', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps({ startedContest: true, transitioned: false });
    const mailDelivery = {
      providerName: 'smtp' as const,
      send: jest.fn(),
    };
    const service = new EventLifecycleService(
      contests,
      sportEvents,
      fakeLogger(),
      mailDelivery,
    );

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(mailDelivery.send).not.toHaveBeenCalled();
  });

  it('pool-master-9ya keeps the transition successful when contest-started email delivery fails', async () => {
    const logger = fakeLogger();
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps({ startedContest: true });
    const mailDelivery = {
      providerName: 'ses' as const,
      send: jest.fn().mockRejectedValue(new Error('SES rejected request')),
    };
    const service = new EventLifecycleService(
      contests,
      sportEvents,
      logger,
      mailDelivery,
    );

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.IN_PROGRESS,
        actor: { type: 'SYSTEM' },
      }),
    ).resolves.toMatchObject({ toStatus: SportEventStatus.IN_PROGRESS });

    expect(mailDelivery.send).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: 'contest-1',
        templateKey: 'CONTEST_STARTED_SUMMARY',
      }),
      'Failed to deliver contest started summary email',
    );
  });
});

describe('EventLifecycleService on an unknown event', () => {
  it('refuses with 404 SPORT_EVENT_NOT_FOUND and changes nothing', async () => {
    const { sportEvents, storedEvent } = seededEvents();
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger());

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'no-such-event',
        toStatus: SportEventStatus.IN_PROGRESS,
        actor: { type: 'SYSTEM' },
      }),
    ).rejects.toMatchObject({ name: 'EventLifecycleError', code: 'SPORT_EVENT_NOT_FOUND', statusCode: 404 });
    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });
});

describe('EventLifecycleError', () => {
  it('pool-master-g1z defaults to 422 SPORT_EVENT_INVALID_TRANSITION', () => {
    const error = new EventLifecycleError('bad transition');
    expect(error.code).toBe('SPORT_EVENT_INVALID_TRANSITION');
    expect(error.statusCode).toBe(422);
    expect(error.name).toBe('EventLifecycleError');
  });
});

describe('EventLifecycleService contest-started emails', () => {
  const START = { sportEventId: 'sport-event-1', toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' as const } };

  function mail() {
    return {
      providerName: 'smtp' as const,
      send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail-1' })),
    };
  }

  it('still starts the contest when no mail delivery is wired, and sends nothing', async () => {
    const { sportEvents } = seededEvents();
    const contests = contestDeps({ startedContest: true });

    await new EventLifecycleService(contests, sportEvents, fakeLogger()).applySportEventStatusTransition(START);

    expect(contests.contests.transitionStatus).toHaveBeenCalledWith('contest-1', expect.objectContaining({ to: ContestStatus.ACTIVE }));
    expect(contests.users.findById).not.toHaveBeenCalled();
  });

  it('starts the contest but emails nobody when its league is gone', async () => {
    const { sportEvents } = seededEvents();
    const contests = contestDeps({ startedContest: true });
    contests.leagues.findById = jest.fn().mockResolvedValue(null);
    const mailDelivery = mail();

    await new EventLifecycleService(contests, sportEvents, fakeLogger(), mailDelivery).applySportEventStatusTransition(START);

    expect(contests.contests.transitionStatus).toHaveBeenCalled();
    expect(mailDelivery.send).not.toHaveBeenCalled();
  });

  it('emails each active person once, skipping deactivated users, and greets a user with no name by username, then email', async () => {
    const { sportEvents } = seededEvents();
    const contests = contestDeps({ startedContest: true });
    const people = [
      buildUser({ id: 'commissioner-1', email: 'commissioner@example.com', firstName: '', lastName: '', username: 'chris' }),
      buildUser({ id: 'member-1', email: 'member@example.com', firstName: ' ', lastName: '', username: '' }),
      buildUser({ id: 'gone-1', email: 'gone@example.com', isActive: false }),
    ];
    contests.users.findById = jest.fn().mockImplementation(async (id: string) => people.find((user) => user.id === id) ?? null);
    contests.memberships.findByLeague = jest.fn().mockResolvedValue([
      buildMembership({ leagueId: 'league-1', userId: 'commissioner-1', role: LeagueRole.COMMISSIONER }),
      buildMembership({ leagueId: 'league-1', userId: 'gone-1', role: LeagueRole.COMMISSIONER }),
    ]);
    // The commissioner is also on the entry's squad: one email, not two.
    contests.squadMemberships.findBySquad = jest.fn().mockResolvedValue([
      { userId: 'member-1' }, { userId: 'commissioner-1' },
    ]);
    const mailDelivery = mail();

    await new EventLifecycleService(contests, sportEvents, fakeLogger(), mailDelivery).applySportEventStatusTransition(START);

    const recipients = mailDelivery.send.mock.calls.map(([message]) => message.to);
    expect(recipients).toHaveLength(2);
    expect(recipients).toEqual(expect.arrayContaining(['commissioner@example.com', 'member@example.com']));
    const textTo = (to: string) => mailDelivery.send.mock.calls.find(([message]) => message.to === to)?.[0].text ?? '';
    expect(textTo('commissioner@example.com')).toContain('chris');
    expect(textTo('member@example.com')).toContain('member@example.com');
  });
});
