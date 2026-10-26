/**
 * The commissioner event emails (#845): "Coming up soon" (C1), "Ready for contests" (C2) and
 * "Your contest isn't open yet" (C4), queued by the scheduler's sweep. The contest world is in
 * memory; the email service is the real one over an in-memory outbox, so the tests assert on
 * the emails recorded.
 */
import {
  ContestStatus,
  EventEmailDelivery,
  LeagueRole,
  SelectionType,
  Sport,
  SportEventStatus,
  type ContestConfigTemplate,
  type ContestTemplateEventType,
  type EventPage,
  type League,
  type SportEvent,
  type SportLeague,
} from '@poolmaster/shared/domain';
import type { ContestFinalStandings } from '../../../packages/core-api/src/modules/contests/service';
import { EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
import { CommissionerNotices } from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, inMemoryEmailOptOuts, inMemoryEmailSuppressions, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { TEST_UNSUBSCRIBE, TEST_PLAN_ENTITLEMENTS } from '../../support/email-service';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

/** The tests' clock, a day after the world's contests were created. */
const NOW = new Date('2026-04-02T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);
/** A Monday at 3am US Eastern (daylight time), when every weekly digest goes by default. */
const MONDAY = new Date('2026-04-06T07:00:00.000Z');
const mondayPlus = (days: number) => new Date(MONDAY.getTime() + days * DAY);
const SPORT_LEAGUE_NAMES: Record<string, string> = { 'pga-tour': 'PGA Tour', lpga: 'LPGA Tour', nfl: 'NFL' };

describe('CommissionerNotices', () => {
  let world: InMemoryContestWorld;
  let outbox: InMemoryEmailMessages;
  let templates: ContestConfigTemplate[];
  let finals: Map<string, ContestFinalStandings>;
  let eventPages: Map<string, EventPage>;
  let eventPageReads: number;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    templates = [];
    finals = new Map();
    eventPages = new Map();
    eventPageReads = 0;
  });

  function notices(): CommissionerNotices {
    const config = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' });
    const logger = fakeLogger();
    const email = new EmailService({
      messages: outbox,
      providerName: 'smtp',
      readConfig: () => config,
      planEntitlements: TEST_PLAN_ENTITLEMENTS,
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
      readConfig: () => config,
      sportLeagues: { findById: async (id) => ({ id, name: SPORT_LEAGUE_NAMES[id] ?? id } as SportLeague) },
      memberships: world.membershipRepo(),
      users: world.userRepo(),
      eventPages: { pagesByEvent: () => { eventPageReads += 1; return Promise.resolve(eventPages); } },
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
    it("tells every active commissioner of every active league once, each league its own, 10 days before an event that is still a draft, with the ways to play it linking to the league's contest types page", async () => {
      const office = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
      const family = world.addLeague({ name: 'Family League' });
      const closed = world.addLeague({ isActive: false });
      const casey = person(office.id, 'Casey');
      world.addMember(family.id, casey.id, { role: LeagueRole.COMMISSIONER });
      const jordan = person(family.id, 'Jordan');
      person(office.id, 'Morgan', LeagueRole.MEMBER);
      person(closed.id, 'Gone');
      event({ name: 'The Masters', status: SportEventStatus.DRAFT, startDate: inDays(9.5) });
      templates = [template({ id: 'pick-6', name: 'Tiered: Pick 6' })];

      await notices().queueDue(NOW);
      await notices().queueDue(new Date(NOW.getTime() + HOUR));

      expect(sent('EVENT_COMING_UP').map(({ userId, leagueId }) => `${userId}@${leagueId}`).sort())
        .toEqual([`${casey.id}@${office.id}`, `${casey.id}@${family.id}`, `${jordan.id}@${family.id}`].sort());
      const text = textTo('EVENT_COMING_UP', casey.id, office);
      expect(text).toContain("The Masters starts Sat, Apr 11, 2026. Get ready to set up Office League's contest.");
      expect(text).toContain("It isn't open for contests yet. We'll email you when it is.");
      expect(text).toContain('Coming up soon\nThe Masters (PGA Tour), Sat, Apr 11, 2026');
      expect(text).toContain('Ways to play:\nTiered: Pick 6: https://app.example.test/league/OFFICE24/contest-types');
      expect(text).toContain('Plan your contest: https://app.example.test/league/OFFICE24/admin/contests');
      expect(text).not.toContain('See every way to play');
      expect(text).toContain('Not affiliated with PGA Tour or any sports league.');
      expect(text).not.toContain('Last year');
      const html = outbox.rows.find((row) => row.templateKey === 'EVENT_COMING_UP' && row.leagueId === office.id)?.htmlBody ?? '';
      expect(html).toContain('src="https://app.example.test/email/sports/golf.jpg"');
      expect(html).toContain('src="https://app.example.test/email/formats/tiered.png"');
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
      expect(text).toContain('Last year in Office League:\nGreen Jackets won Masters Pick 6.\nAzalea and Magnolia tied for Masters Salary Cap.');
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
    it('tells commissioners of leagues with no contest on a released event within 7 days, with its field and the default setups offered on it in their order, each opening Create contest with the setup and the event chosen', async () => {
      const office = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
      const busy = world.addLeague({ name: 'Busy League' });
      const casey = person(office.id, 'Casey');
      person(busy.id, 'Riley');
      const masters = event({ name: 'The Masters', startDate: inDays(6) });
      world.addContest(busy.id, { status: ContestStatus.DRAFT, sportEventIds: [masters.id] });
      templates = [
        template({ id: 'pick-6', name: 'Tiered: Pick 6', sortOrder: 2 }),
        template({ id: 'tour-salary', name: 'Budget Pick: Tour Salary Cap', sportLeagueId: 'pga-tour', selectionType: SelectionType.BUDGET_PICK, sortOrder: 1 }),
        template({ id: 'variation', name: 'Pick 4 Tiers', isDefault: false }),
        template({ id: 'other-tour', name: 'LPGA Pick 6', sportLeagueId: 'lpga' }),
        template({ id: 'football', name: 'Weekly Pick\'em', sport: Sport.AMERICAN_FOOTBALL }),
      ];

      await notices().queueDue(NOW);
      await notices().queueDue(new Date(NOW.getTime() + HOUR));

      expect(sent('EVENT_READY_FOR_CONTESTS').map(({ userId }) => userId)).toEqual([casey.id]);
      expect(sent('EVENT_COMING_UP')).toEqual([]);
      const text = textTo('EVENT_READY_FOR_CONTESTS', casey.id, office);
      expect(text).toContain('Ready for contests\nThe Masters (PGA Tour), Wed, Apr 8, 2026');
      expect(text).toContain("The Masters is ready. Pick a way to play and set up Office League's contest with it already chosen.");
      expect(text).toContain([
        'Choose a way to play:',
        `Budget Pick: Tour Salary Cap: https://app.example.test/league/OFFICE24/admin/contests/new?template=tour-salary&event=${masters.id}`,
        `Tiered: Pick 6: https://app.example.test/league/OFFICE24/admin/contests/new?template=pick-6&event=${masters.id}`,
        '',
      ].join('\n'));
      expect(text).toContain('See every way to play: https://app.example.test/league/OFFICE24/contest-types\nField: 40 golfers');
    });

    it("sends C2's \"See every way to play\" and C1's tiles to the event's page when one offers it, and to the contest types page otherwise, reading the pages once a run", async () => {
      const office = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
      const casey = person(office.id, 'Casey');
      const masters = event({ name: 'The Masters', startDate: inDays(6) });
      event({ name: 'The Players', startDate: inDays(9.5) });
      const open = event({ name: 'The Open', status: SportEventStatus.DRAFT, startDate: inDays(9.5) });
      eventPages.set(masters.id, { id: 'page-masters', sport: Sport.GOLF, slug: 'the-masters', displayOrder: 1, isActive: true, redirectTo: null });
      eventPages.set(open.id, { id: 'page-open', sport: Sport.GOLF, slug: 'the-open', displayOrder: 2, isActive: true, redirectTo: null });

      templates = [template({ id: 'pick-6', name: 'Tiered: Pick 6' })];

      await notices().queueDue(NOW);

      expect(textTo('EVENT_READY_FOR_CONTESTS', casey.id, office)).toContain('See every way to play: https://app.example.test/play/golf/the-masters');
      const comingUp = sent('EVENT_COMING_UP').map(({ text }) => text);
      expect(comingUp.filter((text) => text.includes('Tiered: Pick 6: https://app.example.test/play/golf/the-open'))).toHaveLength(1);
      expect(comingUp.filter((text) => text.includes('Tiered: Pick 6: https://app.example.test/league/OFFICE24/contest-types'))).toHaveLength(1);
      expect(comingUp.some((text) => text.includes('See every way to play'))).toBe(false);
      expect(eventPageReads).toBe(1);
    });

    it("tells no commissioner of a league that muted the event's sport league, coming up or ready, while a league that muted another one is told", async () => {
      const muted = world.addLeague({ name: 'No Golf League', mutedSportLeagueIds: ['pga-tour'] });
      const other = world.addLeague({ name: 'No Racing League', mutedSportLeagueIds: ['nascar'] });
      person(muted.id, 'Casey');
      const riley = person(other.id, 'Riley');
      event({ name: 'The Masters', startDate: inDays(9.5) });
      event({ name: 'The Open', startDate: inDays(6) });

      await notices().queueDue(NOW);

      const told = outbox.rows.map((row) => [row.templateKey, row.recipientUserId]);
      expect(told).toHaveLength(2);
      expect(told).toEqual(expect.arrayContaining([
        ['EVENT_COMING_UP', riley.id],
        ['EVENT_READY_FOR_CONTESTS', riley.id],
      ]));
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

  describe('Weekly digest', () => {
    it("sends each commissioner of a league that chose the digest one email on Monday listing the next two weeks' events by week, with where the league stands on each and a link to the event's page when one offers it, instead of the per-event emails", async () => {
      const office = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24', eventEmailDelivery: EventEmailDelivery.WEEKLY_DIGEST });
      const perEvent = world.addLeague({ name: 'Per Event League' });
      const casey = person(office.id, 'Casey');
      person(office.id, 'Morgan', LeagueRole.MEMBER);
      const riley = person(perEvent.id, 'Riley');
      const masters = event({ name: 'The Masters', startDate: mondayPlus(2) });
      const heritage = event({ name: 'RBC Heritage', startDate: mondayPlus(4) });
      world.addContest(office.id, { status: ContestStatus.DRAFT, sportEventIds: [heritage.id] });
      eventPages.set(heritage.id, { id: 'page-heritage', sport: Sport.GOLF, slug: 'rbc-heritage', displayOrder: 1, isActive: true, redirectTo: null });
      event({ name: 'Valero Texas Open', status: SportEventStatus.DRAFT, startDate: mondayPlus(9) });
      event({ name: 'Too Far Open', startDate: mondayPlus(15) });
      event({ name: 'Already Started', startDate: new Date(MONDAY.getTime() - HOUR) });
      event({ name: 'Called Off', status: SportEventStatus.CANCELLED, startDate: mondayPlus(3) });

      await notices().queueDue(MONDAY);
      await notices().queueDue(new Date(MONDAY.getTime() + HOUR));

      expect(sent('EVENT_WEEKLY_DIGEST').map(({ userId, leagueId }) => `${userId}@${leagueId}`)).toEqual([`${casey.id}@${office.id}`]);
      expect(outbox.rows.filter((row) => row.leagueId === office.id).map((row) => row.templateKey)).toEqual(['EVENT_WEEKLY_DIGEST']);
      expect(sent('EVENT_READY_FOR_CONTESTS').map(({ userId }) => userId)).toEqual([riley.id, riley.id]);
      const text = textTo('EVENT_WEEKLY_DIGEST', casey.id, office);
      expect(text).toContain('3 events start in the next two weeks in the sport leagues you get event emails for.');
      expect(text).toContain([
        'This week:',
        '',
        'The Masters (PGA Tour), Wed, Apr 8, 2026',
        `Ready for contests. Create contest: https://app.example.test/league/OFFICE24/admin/contests/new?event=${masters.id}`,
        '',
        'RBC Heritage (PGA Tour), Fri, Apr 10, 2026',
        'Contest set up',
        'See every way to play: https://app.example.test/play/golf/rbc-heritage',
        '',
        'Next week:',
        '',
        'Valero Texas Open (PGA Tour), Wed, Apr 15, 2026',
        'Not ready for contests yet',
      ].join('\n'));
      expect(text).not.toContain('Too Far Open');
      expect(text).not.toContain('Already Started');
      expect(text).not.toContain('Called Off');
    });

    it("goes to every league at once, from 3am on Monday US Eastern, and once a week", async () => {
      const office = world.addLeague({ eventEmailDelivery: EventEmailDelivery.WEEKLY_DIGEST });
      const family = world.addLeague({ eventEmailDelivery: EventEmailDelivery.WEEKLY_DIGEST });
      const casey = person(office.id, 'Casey');
      world.addMember(family.id, casey.id, { role: LeagueRole.COMMISSIONER });
      const kim = person(family.id, 'Kim');
      event({ name: 'The Masters', startDate: mondayPlus(3) });
      event({ name: 'RBC Heritage', startDate: mondayPlus(10) });
      const digests = () => sent('EVENT_WEEKLY_DIGEST').map(({ userId, leagueId }) => `${userId}@${leagueId}`).sort();
      const firstWeek = [`${casey.id}@${office.id}`, `${casey.id}@${family.id}`, `${kim.id}@${family.id}`].sort();

      // 2:30am Monday Eastern, and 3am on the Sunday before: not yet.
      await notices().queueDue(new Date('2026-04-06T06:30:00.000Z'));
      await notices().queueDue(new Date('2026-04-05T07:00:00.000Z'));
      expect(digests()).toEqual([]);
      await notices().queueDue(MONDAY);
      await notices().queueDue(new Date(MONDAY.getTime() + 5 * HOUR));
      expect(digests()).toEqual(firstWeek);
      await notices().queueDue(mondayPlus(7));

      expect(digests()).toHaveLength(6);

      // In winter (EST) 3am Eastern is 08:00 UTC.
      event({ name: 'Winter Open', startDate: new Date('2026-11-05T12:00:00.000Z') });
      await notices().queueDue(new Date('2026-11-02T07:30:00.000Z'));
      expect(digests()).toHaveLength(6);
      await notices().queueDue(new Date('2026-11-02T08:00:00.000Z'));
      expect(digests()).toHaveLength(9);
    });

    it("leaves out muted sport leagues and a football season's later weeks, and sends nothing when no event is coming up", async () => {
      const league = world.addLeague({ eventEmailDelivery: EventEmailDelivery.WEEKLY_DIGEST, mutedSportLeagueIds: ['lpga'] });
      const casey = person(league.id, 'Casey');
      event({ name: 'LPGA Open', sportLeagueId: 'lpga', startDate: mondayPlus(3) });
      await notices().queueDue(MONDAY);
      expect(sent('EVENT_WEEKLY_DIGEST')).toEqual([]);

      const week = (name: string, days: number) => event({
        name,
        sport: Sport.AMERICAN_FOOTBALL,
        rounds: 1,
        sportLeagueId: 'nfl',
        eventYear: 2026,
        startDate: mondayPlus(days),
      });
      week('Week 1', 5);
      week('Week 2', 12);
      await notices().queueDue(new Date(MONDAY.getTime() + HOUR));

      const text = textTo('EVENT_WEEKLY_DIGEST', casey.id, league);
      expect(text).toContain('Week 1 (NFL)');
      expect(text).not.toContain('Week 2');
      expect(text).not.toContain('LPGA Open');
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
      expect(text).toContain('Masters Pick 6 is still a draft, and its picks close Apr 4, 2026, 5:36 AM EDT.');
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
      description: 'Pick a golfer from each tier.',
      sortOrder: 0,
      isDefault: true,
      active: true,
      ...overrides,
    } as ContestConfigTemplate;
  }
});
