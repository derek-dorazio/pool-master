/**
 * The end of a league's Premium preview period (#986): its commissioners are reminded 30, 7 and 1
 * days before, at the overnight hour, and once the date has passed the league moves to Free. The
 * league world is in memory; the email service is the real one over an in-memory outbox, so the
 * tests assert on the emails recorded.
 */
import { LeaguePlan, LeagueRole, type League, type User } from '@poolmaster/shared/domain';
import { EMAIL_SETTINGS } from '../../../packages/core-api/src/modules/email';
import { PlanPreviewNotices } from '../../../packages/core-api/src/modules/notifications';
import { LeaguePlanService } from '../../../packages/core-api/src/modules/plans/league-plan-service';
import { PlanEntitlementsService } from '../../../packages/core-api/src/modules/plans/plan-entitlements-service';
import { PLAN_SETTINGS } from '../../../packages/core-api/src/modules/plans/plan-settings';
import { emailServiceInto } from '../../support/email-service';
import { expectDefined } from '../../support/expect-defined';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';

/** 2:30pm US Eastern (daylight time) on Saturday 2027-04-24: the preview period ends. */
const ENDS_AT = new Date('2027-04-24T18:30:00.000Z');
/** 3am US Eastern, the overnight hour (EMAIL_CONFIG.weeklyDigestHour), on an Eastern date in 2027 after daylight time starts. */
const overnight = (date: string) => new Date(`2027-${date}T07:00:00.000Z`);
const HOUR = 60 * 60_000;

describe('PlanPreviewNotices', () => {
  let world: InMemoryLeagueWorld;
  let outbox: InMemoryEmailMessages;
  let league: League;
  let commissioner: User;

  beforeEach(() => {
    world = inMemoryLeagueWorld();
    outbox = inMemoryEmailMessages();
    league = world.addLeague({ name: 'Office Pool', leagueCode: 'OFFICE', plan: LeaguePlan.PREMIUM, planRenewsAt: ENDS_AT });
    commissioner = world.addUser({ firstName: 'Casey', lastName: 'Commish', email: 'casey@example.com' });
    world.addMember({ league, user: commissioner, role: LeagueRole.COMMISSIONER });
  });

  function notices(overrides: { findPlansEndingFails?: boolean } = {}) {
    const logger = fakeLogger();
    const planEntitlements = new PlanEntitlementsService({ leagues: world.leagues, readConfig: () => PLAN_SETTINGS.defaults({}) });
    const service = new PlanPreviewNotices({
      leagues: overrides.findPlansEndingFails
        ? { findPlansEndingBetween: async () => { throw new Error('connection reset'); } }
        : world.leagues,
      plans: new LeaguePlanService({ leagues: world.leagues, planEntitlements }),
      planEntitlements,
      memberships: world.memberships,
      users: world.users,
      email: emailServiceInto(outbox),
      readConfig: () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }),
      appBaseUrl: 'https://app.example.test',
      logger,
    });
    return { service, logger };
  }

  const reminders = () => outbox.rows.filter((row) => row.templateKey === 'LEAGUE_PLAN_PREVIEW_ENDING');

  it('reminds the commissioners 30 days before the preview period ends, saying what Free allows and linking to the Plan page', async () => {
    await notices().service.queueDue(overnight('03-25'));

    expect(reminders()).toHaveLength(1);
    const email = expectDefined(reminders()[0]);
    expect(email).toMatchObject({ recipientEmail: 'casey@example.com', subject: 'Office Pool\'s Premium preview period ends in 30 days' });
    expect(email.textBody).toContain('Office Pool was gifted Premium for its preview period. The preview period ends in 30 days');
    expect(email.textBody).toContain('After that, Office Pool moves to the Free plan: up to 20 entries per contest and 5 sports leagues a year.');
    expect(email.textBody).toContain('See your plan: https://app.example.test/league/OFFICE/admin/plan');
  });

  it('reminds them again 7 days and 1 day before, the last saying it ends tomorrow', async () => {
    const { service } = notices();

    for (const date of ['03-25', '03-26', '04-17', '04-18', '04-23']) {
      await service.queueDue(overnight(date));
    }

    expect(reminders().map((row) => row.subject)).toEqual([
      'Office Pool\'s Premium preview period ends in 30 days',
      'Office Pool\'s Premium preview period ends in 7 days',
      'Office Pool\'s Premium preview period ends tomorrow',
    ]);
  });

  it('sends each reminder once, however many sweeps run that day', async () => {
    const { service } = notices();

    await service.queueDue(overnight('04-17'));
    await service.queueDue(new Date(overnight('04-17').getTime() + 5 * HOUR));

    expect(reminders()).toHaveLength(1);
  });

  it('waits for the overnight hour in US Eastern time before sending a reminder', async () => {
    // 2am Eastern on the day the 30-day reminder is due.
    await notices().service.queueDue(new Date(overnight('03-25').getTime() - HOUR));

    expect(reminders()).toHaveLength(0);
  });

  it('sends only the most urgent reminder due when earlier ones were missed, saying the days really left', async () => {
    const { service } = notices();

    await service.queueDue(overnight('04-20'));
    await service.queueDue(overnight('04-21'));

    expect(reminders().map((row) => row.subject)).toEqual(['Office Pool\'s Premium preview period ends in 4 days']);
    expect(expectDefined(reminders()[0]).textBody).toContain('The preview period ends in 4 days');
  });

  it('starts the reminders over for the new date when the preview period is extended', async () => {
    const { service } = notices();
    await service.queueDue(overnight('04-17'));
    await world.leagues.extendPlanRenewal(league.id, { renewsAt: new Date('2027-10-24T18:30:00.000Z'), changedById: commissioner.id });

    await service.queueDue(overnight('04-23'));
    await service.queueDue(new Date('2027-09-24T07:00:00.000Z'));

    expect(reminders().map((row) => row.subject)).toEqual([
      'Office Pool\'s Premium preview period ends in 7 days',
      'Office Pool\'s Premium preview period ends in 30 days',
    ]);
  });

  it('tells only the commissioners, not the members', async () => {
    world.addMember({ league, user: world.addUser({ email: 'morgan@example.com' }) });

    await notices().service.queueDue(overnight('03-25'));

    expect(reminders().map((row) => row.recipientEmail)).toEqual(['casey@example.com']);
  });

  it('reminds a commissioner of two leagues ending at the same moment once for each league', async () => {
    const other = world.addLeague({ name: 'Golf Pool', plan: LeaguePlan.PRO, planRenewsAt: ENDS_AT });
    world.addMember({ league: other, user: commissioner, role: LeagueRole.COMMISSIONER });

    await notices().service.queueDue(overnight('03-25'));

    expect(reminders().map((row) => row.subject ?? '').sort((left, right) => left.localeCompare(right))).toEqual([
      'Golf Pool\'s Premium preview period ends in 30 days',
      'Office Pool\'s Premium preview period ends in 30 days',
    ]);
  });

  it('sends no reminder to a league already on Free or no longer active', async () => {
    await world.leagues.update(league.id, { plan: LeaguePlan.FREE });
    const inactive = world.addLeague({ plan: LeaguePlan.PREMIUM, planRenewsAt: ENDS_AT, isActive: false });
    world.addMember({ league: inactive, user: commissioner, role: LeagueRole.COMMISSIONER });

    await notices().service.queueDue(overnight('03-25'));

    expect(reminders()).toHaveLength(0);
  });

  it('moves the league to Free once its preview period has ended, with no grace period', async () => {
    const { service } = notices();

    await service.queueDue(new Date(ENDS_AT.getTime() - 60_000));
    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.PREMIUM);

    await service.queueDue(ENDS_AT);
    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.FREE);
    expect(world.planChanges).toEqual([{ leagueId: league.id, fromPlan: LeaguePlan.PREMIUM, toPlan: LeaguePlan.FREE, changedById: null }]);
  });

  it('still moves an ended league to Free when the reminders fail', async () => {
    await expect(notices({ findPlansEndingFails: true }).service.queueDue(ENDS_AT)).rejects.toThrow('connection reset');

    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.FREE);
  });
});
