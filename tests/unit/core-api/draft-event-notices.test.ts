/**
 * "Event still in draft" (#845 G1), queued by the scheduler's sweep for root admins. The events
 * and users are in memory; the email service is the real one over an in-memory outbox, so the
 * tests assert on the emails recorded.
 */
import { Sport, SportEventStatus, type SportEvent, type User } from '@poolmaster/shared/domain';
import { EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
import { DraftEventNotices } from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, inMemoryEmailOptOuts, inMemoryEmailSuppressions, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { TEST_UNSUBSCRIBE, TEST_PLAN_ENTITLEMENTS } from '../../support/email-service';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

const NOW = new Date('2026-04-02T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('DraftEventNotices', () => {
  let world: InMemoryContestWorld;
  let outbox: InMemoryEmailMessages;
  let blockers: Map<string, string[]>;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    blockers = new Map();
  });

  function notices(): DraftEventNotices {
    const config = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' });
    const logger = fakeLogger();
    const users = (): User[] => [...world.users.values()];
    return new DraftEventNotices({
      sportEvents: world.sportEventRepo(),
      releaseReadiness: { releaseBlockersOf: async (sportEventId) => blockers.get(sportEventId) ?? [] },
      users: {
        findActiveRootAdmins: async () => users().filter((user) => user.isActive && user.isRootAdmin === true),
      },
      email: new EmailService({
        messages: outbox,
        providerName: 'smtp',
        readConfig: () => config,
        planEntitlements: TEST_PLAN_ENTITLEMENTS,
        senderAddress: 'noreply@poolmaster.test',
        suppressions: inMemoryEmailSuppressions(),
        optOuts: inMemoryEmailOptOuts(),
        unsubscribe: TEST_UNSUBSCRIBE,
        logger,
      }),
      appBaseUrl: 'https://app.example.test/',
      logger,
    });
  }

  function draft(overrides: Partial<SportEvent> & { startDate: Date }): SportEvent {
    return world.addSportEvent({ status: SportEventStatus.DRAFT, ...overrides });
  }

  it('tells every active root admin, from the app, what a draft starting within 7 days still needs, with a link to the event', async () => {
    const riley = world.addUser({ firstName: 'Riley', isRootAdmin: true });
    world.addUser({ firstName: 'Former', isRootAdmin: true, isActive: false });
    world.addUser({ firstName: 'Member' });
    const masters = draft({ name: 'The Masters', startDate: inDays(6.5) });
    blockers.set(masters.id, ['its field is not loaded', 'its prices have not been assigned']);

    await notices().queueDue(NOW);
    await notices().queueDue(new Date(NOW.getTime() + HOUR));

    expect(outbox.rows.map((row) => [row.templateKey, row.recipientUserId, row.leagueId])).toEqual([['EVENT_STILL_DRAFT', riley.id, undefined]]);
    const text = outbox.rows[0]?.textBody ?? '';
    expect(text).toContain('The Masters starts in 7 days (Wed, Apr 8, 2026) and is still a draft, so no league can set up a contest on it.');
    expect(text).toContain('Still needed before release:\n- its field is not loaded\n- its prices have not been assigned');
    expect(text).toContain(`Open event: https://app.example.test/manage/sports/golf/events/${masters.id}`);
  });

  it('tells again each day until the event starts, and says when one that is ready only needs releasing', async () => {
    const riley = world.addUser({ firstName: 'Riley', isRootAdmin: true });
    const race = draft({ name: 'Daytona 500', sport: Sport.AUTO_RACING, startDate: inDays(2.5) });

    await notices().queueDue(NOW);
    await notices().queueDue(inDays(1));
    await notices().queueDue(inDays(2));
    await notices().queueDue(inDays(2.6));

    const texts = outbox.rows.filter((row) => row.recipientUserId === riley.id).map((row) => row.textBody ?? '');
    expect(texts.map((text) => /starts (in \d days|within a day)/.exec(text)?.[0])).toEqual(['starts in 3 days', 'starts in 2 days', 'starts within a day']);
    expect(texts[0]).toContain('It has everything it needs: release it.');
    expect(texts[0]).toContain(`https://app.example.test/manage/sports/auto-racing/events/${race.id}`);
  });

  it('sends nothing for a draft more than 7 days out or already started, or for a released event', async () => {
    world.addUser({ firstName: 'Riley', isRootAdmin: true });
    draft({ name: 'Far Off', startDate: inDays(7.5) });
    draft({ name: 'Started', startDate: new Date(NOW.getTime() - HOUR) });
    world.addSportEvent({ name: 'Released', status: SportEventStatus.SCHEDULED, startDate: inDays(3) });

    await notices().queueDue(NOW);

    expect(outbox.rows).toEqual([]);
  });
});
