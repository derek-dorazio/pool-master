/**
 * The commissioner event emails (#845): "Coming up soon" (C1), "Ready for contests" (C2) and
 * "Your contest isn't open yet" (C4), queued by the scheduler's sweep. The contest world is in
 * memory; the email service is the real one over an in-memory outbox, so the tests assert on
 * the emails recorded.
 */
import {
  ContestStatus,
  LeagueRole,
  SelectionType,
  Sport,
  SportEventStatus,
  type ContestConfigTemplate,
  type ContestTemplateEventType,
  type League,
  type SportEvent,
} from '@poolmaster/shared/domain';
import type { ContestFinalStandings } from '../../../packages/core-api/src/modules/contests/service';
import { EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
import { CommissionerNotices } from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, inMemoryEmailOptOuts, inMemoryEmailSuppressions, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { TEST_UNSUBSCRIBE } from '../../support/email-service';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

/** The tests' clock, a day after the world's contests were created. */
const NOW = new Date('2026-04-02T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('CommissionerNotices', () => {
  let world: InMemoryContestWorld;
  let outbox: InMemoryEmailMessages;
  let templates: ContestConfigTemplate[];
  let finals: Map<string, ContestFinalStandings>;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    templates = [];
    finals = new Map();
  });

  function notices(): CommissionerNotices {
    const config = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' });
    const logger = fakeLogger();
    const email = new EmailService({
      messages: outbox,
      providerName: 'smtp',
      readConfig: () => config,
      senderAddress: 'noreply@poolmaster.test',
      suppressions: inMemoryEmailSuppressions(),
      optOuts: inMemoryEmailOptOuts(),
      unsubscribe: TEST_UNSUBSCRIBE,
      logger,
    });
    return new CommissionerNotices({
      sportEvents: world.sportEventRepo(),
      contests: world.contestRepo(),
      configurations: world.configurationRepo(),
      matches: { findBySportEvent: async () => [] },
      templates: { list: async () => templates },
      leagues: world.leagueRepo(),
      memberships: world.membershipRepo(),
      users: world.userRepo(),
      finalStandings: { finalStandingsOf: async (contest) => finals.get(contest.id) ?? { scoringDefinitionId: null, entries: [] } },
      email,
      appBaseUrl: 'https://app.example.test/',
      logger,
    });
  }

  function person(leagueId: string, firstName: string, role: LeagueRole = LeagueRole.COMMISSIONER) {
    const user = world.addUser({ firstName, lastName: 'Person' });
    world.addMember(leagueId, user.id, { role });
    return user;
  }

  function event(overrides: Partial<SportEvent> & { startDate: Date }): SportEvent {
    return world.addSportEvent({
      sportLeagueId: 'pga-tour',
      eventSeriesId: `series-${overrides.name ?? 'The Masters'}`,
      eventYear: 2026,
      ...overrides,
    });
  }

  function sent(templateKey: string): Array<{ userId: string | undefined; leagueId: string | undefined; text: string }> {
    return outbox.rows
      .filter((row) => row.templateKey === templateKey)
      .map((row) => ({ userId: row.recipientUserId, leagueId: row.leagueId, text: row.textBody ?? '' }));
  }

  function textTo(templateKey: string, userId: string, league: League): string {
    return sent(templateKey).find((row) => row.userId === userId && row.leagueId === league.id)?.text ?? '';
  }

  describe('Coming up soon (C1)', () => {
    it('tells every active commissioner of every active league once, each league its own, 10 days before an event that is still a draft', async () => {
      const office = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
      const family = world.addLeague({ name: 'Family League' });
      const closed = world.addLeague({ isActive: false });
      const casey = person(office.id, 'Casey');
      world.addMember(family.id, casey.id, { role: LeagueRole.COMMISSIONER });
      const jordan = person(family.id, 'Jordan');
      person(office.id, 'Morgan', LeagueRole.MEMBER);
      person(closed.id, 'Gone');
      event({ name: 'The Masters', status: SportEventStatus.DRAFT, startDate: inDays(9.5) });

      await notices().queueDue(NOW);
      await notices().queueDue(new Date(NOW.getTime() + HOUR));

      expect(sent('EVENT_COMING_UP').map(({ userId, leagueId }) => `${userId}@${leagueId}`).sort())
        .toEqual([`${casey.id}@${office.id}`, `${casey.id}@${family.id}`, `${jordan.id}@${family.id}`].sort());
      const text = textTo('EVENT_COMING_UP', casey.id, office);
      expect(text).toContain("The Masters starts Apr 12, 2026, 12:00 AM UTC. Get ready to set up Office League's contest.");
      expect(text).toContain("It isn't open for contests yet. We'll email you when it is.");
      expect(text).toContain("Your league's contests: https://app.example.test/league/OFFICE24/admin/contests");
      expect(text).not.toContain('Last year');
    });

    it("names last year's winners of each league's own one-event contests on the event's previous edition, not a season contest that included it, and nothing for a league that had none", async () => {
      const office = world.addLeague({ name: 'Office League' });
      const family = world.addLeague({ name: 'Family League' });
      const casey = person(office.id, 'Casey');
      const jordan = person(family.id, 'Jordan');
      const previous = event({ name: 'The Masters', eventYear: 2025, status: SportEventStatus.COMPLETED, startDate: new Date('2025-04-10T12:00:00.000Z') });
      event({ name: 'Another Open', eventYear: 2025, status: SportEventStatus.COMPLETED, startDate: new Date('2025-04-17T12:00:00.000Z') });
      const pick6 = world.addContest(office.id, { name: 'Masters Pick 6', status: ContestStatus.COMPLETED, sportEventIds: [previous.id] });
      const tied = world.addContest(office.id, { name: 'Masters Salary Cap', status: ContestStatus.COMPLETED, sportEventIds: [previous.id] });
      finals.set(pick6.id, standings([['Green Jackets', 1], ['Amen Corner', 2]]));
      finals.set(tied.id, standings([['Azalea', 1], ['Magnolia', 1], ['Rae\'s Creek', 3]]));
      const otherMajor = event({ name: 'The Open', eventYear: 2025, status: SportEventStatus.COMPLETED, startDate: new Date('2025-07-17T12:00:00.000Z') });
      const season = world.addContest(office.id, { name: 'Majors Pool', status: ContestStatus.COMPLETED, sportEventIds: [previous.id, otherMajor.id] });
      finals.set(season.id, standings([['Season Champs', 1]]));
      event({ name: 'The Masters', startDate: inDays(9) });

      await notices().queueDue(NOW);

      const text = textTo('EVENT_COMING_UP', casey.id, office);
      expect(text).toContain('Last year:\nGreen Jackets won Masters Pick 6.\nAzalea and Magnolia tied for Masters Salary Cap.');
      expect(text).not.toContain('Majors Pool');
      expect(text).not.toContain("It isn't open for contests yet");
      expect(textTo('EVENT_COMING_UP', jordan.id, family)).not.toContain('Last year');
    });

    it('sends nothing for an event more than 10 days out, within 7 days, postponed or cancelled', async () => {
      const league = world.addLeague();
      person(league.id, 'Casey');
      event({ name: 'Far Off', startDate: inDays(10.5) });
      event({ name: 'Next Week', status: SportEventStatus.DRAFT, startDate: inDays(6) });
      event({ name: 'On Hold', status: SportEventStatus.POSTPONED, startDate: inDays(9) });
      event({ name: 'Called Off', status: SportEventStatus.CANCELLED, startDate: inDays(9) });

      await notices().queueDue(NOW);

      expect(outbox.rows).toEqual([]);
    });

    it("tells of a football season's first week only, not each later week", async () => {
      const league = world.addLeague();
      const casey = person(league.id, 'Casey');
      const week = (name: string, days: number) => event({
        name,
        sport: Sport.AMERICAN_FOOTBALL,
        rounds: 1,
        sportLeagueId: 'nfl',
        eventYear: 2026,
        startDate: inDays(days),
      });
      week('Week 1', 8);
      week('Week 2', 15);
      await notices().queueDue(NOW);
      expect(sent('EVENT_COMING_UP').map(({ text }) => text.includes('Week 1 starts'))).toEqual([true]);

      await notices().queueDue(inDays(7));

      expect(sent('EVENT_COMING_UP')).toHaveLength(1);
      expect(sent('EVENT_COMING_UP')[0]?.userId).toBe(casey.id);
    });
  });

  describe('Ready for contests (C2)', () => {
    it('tells commissioners of leagues with no contest on a released event within 7 days, with its field and the default setups offered on it', async () => {
      const office = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
      const busy = world.addLeague({ name: 'Busy League' });
      const casey = person(office.id, 'Casey');
      person(busy.id, 'Riley');
      const masters = event({ name: 'The Masters', startDate: inDays(6) });
      world.addContest(busy.id, { status: ContestStatus.DRAFT, sportEventIds: [masters.id] });
      templates = [
        template({ id: 'pick-6', name: 'Pick 6 Tiers' }),
        template({ id: 'tour-salary', name: 'Tour Salary Cap', sportLeagueId: 'pga-tour' }),
        template({ id: 'variation', name: 'Pick 4 Tiers', isDefault: false }),
        template({ id: 'other-tour', name: 'LPGA Pick 6', sportLeagueId: 'lpga' }),
        template({ id: 'football', name: 'Weekly Pick\'em', sport: Sport.AMERICAN_FOOTBALL }),
      ];

      await notices().queueDue(NOW);
      await notices().queueDue(new Date(NOW.getTime() + HOUR));

      expect(sent('EVENT_READY_FOR_CONTESTS').map(({ userId }) => userId)).toEqual([casey.id]);
      expect(sent('EVENT_COMING_UP')).toEqual([]);
      const text = textTo('EVENT_READY_FOR_CONTESTS', casey.id, office);
      expect(text).toContain("The Masters is ready. Set up Office League's contest.");
      expect(text).toContain('Starts: Apr 8, 2026, 12:00 PM UTC');
      expect(text).toContain('Field: 40 golfers');
      expect(text).toContain([
        'Contest setups for it:',
        'Pick 6 Tiers: https://app.example.test/league/OFFICE24/admin/contests/new?template=pick-6',
        'Tour Salary Cap: https://app.example.test/league/OFFICE24/admin/contests/new?template=tour-salary',
        '',
      ].join('\n'));
      expect(text).toContain('Create contest: https://app.example.test/league/OFFICE24/admin/contests/new');
    });

    it('waits for a draft event to be released, then tells at once', async () => {
      const league = world.addLeague();
      const casey = person(league.id, 'Casey');
      const masters = event({ name: 'The Masters', status: SportEventStatus.DRAFT, startDate: inDays(5) });

      await notices().queueDue(NOW);
      expect(outbox.rows).toEqual([]);

      masters.status = SportEventStatus.SCHEDULED;
      await notices().queueDue(new Date(NOW.getTime() + HOUR));

      expect(sent('EVENT_READY_FOR_CONTESTS').map(({ userId }) => userId)).toEqual([casey.id]);
    });

    it('tells a league that joins after the others were told, and leaves out the field line while the field is empty', async () => {
      const first = world.addLeague();
      person(first.id, 'Casey');
      const masters = event({ name: 'The Masters', startDate: inDays(5) });
      world.fieldSizes.set(masters.id, 0);
      await notices().queueDue(NOW);

      const later = world.addLeague({ name: 'Later League' });
      const jordan = person(later.id, 'Jordan');
      await notices().queueDue(new Date(NOW.getTime() + HOUR));

      expect(sent('EVENT_READY_FOR_CONTESTS')).toHaveLength(2);
      expect(textTo('EVENT_READY_FOR_CONTESTS', jordan.id, later)).not.toContain('Field:');
    });
  });

  describe("Your contest isn't open yet (C4)", () => {
    it("tells only the contest's league's commissioners once, 48 hours before a draft contest's picks close", async () => {
      const office = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
      const other = world.addLeague();
      const casey = person(office.id, 'Casey');
      person(office.id, 'Morgan', LeagueRole.MEMBER);
      person(other.id, 'Riley');
      const masters = event({ name: 'The Masters', startDate: inDays(1.9) });
      const contest = world.addContest(office.id, { name: 'Masters Pick 6', status: ContestStatus.DRAFT, sportEventIds: [masters.id] });
      world.addConfiguration(contest.id);

      await notices().queueDue(NOW);
      await notices().queueDue(new Date(NOW.getTime() + HOUR));

      expect(sent('CONTEST_NOT_OPEN').map(({ userId }) => userId)).toEqual([casey.id]);
      const text = textTo('CONTEST_NOT_OPEN', casey.id, office);
      expect(text).toContain('Masters Pick 6 is still a draft, and its picks close Apr 4, 2026, 9:36 AM UTC.');
      expect(text).toContain("Members can't enter until you open it.");
      expect(text).toContain(`Open contest: https://app.example.test/league/OFFICE24/admin/contests/${contest.id}`);
    });

    it('sends nothing for a contest whose picks close more than 48 hours out or have closed, one that is open, or one created in the last 6 hours', async () => {
      const league = world.addLeague();
      person(league.id, 'Casey');
      const draft = (startDate: Date, overrides: { status?: ContestStatus; createdAt?: Date } = {}) => {
        const sportEvent = event({ name: `Event ${startDate.toISOString()}`, startDate });
        world.addConfiguration(world.addContest(league.id, { status: ContestStatus.DRAFT, sportEventIds: [sportEvent.id], ...overrides }).id);
      };
      draft(inDays(2.1));
      draft(new Date(NOW.getTime() - HOUR));
      draft(inDays(1), { status: ContestStatus.OPEN });
      draft(inDays(1), { createdAt: new Date(NOW.getTime() - 5 * HOUR) });

      await notices().queueDue(NOW);

      expect(sent('CONTEST_NOT_OPEN')).toEqual([]);
    });
  });

  function standings(places: Array<[string, number]>): ContestFinalStandings {
    return {
      scoringDefinitionId: null,
      entries: places.map(([entryName, position], index) => ({
        entryId: `entry-${index}`,
        entryName,
        squadId: `squad-${index}`,
        squadName: `Squad ${index}`,
        position,
        displayPosition: String(position),
        score: null,
      })),
    };
  }

  function template(overrides: Partial<ContestConfigTemplate> & { id: string; name: string }): ContestConfigTemplate {
    return {
      sport: Sport.GOLF,
      sportLeagueId: null,
      eventType: null as ContestTemplateEventType | null,
      selectionType: SelectionType.TIERED,
      isDefault: true,
      active: true,
      ...overrides,
    } as ContestConfigTemplate;
  }
});
