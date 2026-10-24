/**
 * The year in review (#872 slice 4): last year is ready to send once its championship has a
 * counted contest, until the commissioner sends it; sending emails each active owner of a squad
 * that placed its own year, once. The league is in memory; the email service is the real one over
 * an in-memory outbox, so the tests assert on the emails recorded.
 */
import type { LeagueYearReviewRepository } from '@poolmaster/shared/db';
import {
  CupStatus,
  CupTrophy,
  CupWeight,
  LeagueMembershipStatus,
  LeagueRole,
  YearReviewStatus,
  type League,
  type LeagueYearReview,
  type Squad,
} from '@poolmaster/shared/domain';
import type { ChampionshipStandingView } from '../../../packages/core-api/src/modules/championship/service';
import type { CupView } from '../../../packages/core-api/src/modules/cups/service';
import { EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
import type { SquadYearView } from '../../../packages/core-api/src/modules/history/service';
import {
  YearReviewAlreadySentError,
  YearReviewNothingToSendError,
  YearReviewNotOpenError,
  YearReviewService,
} from '../../../packages/core-api/src/modules/history/year-review-service';
import { TEST_UNSUBSCRIBE } from '../../support/email-service';
import { fakeLogger } from '../../support/fake-logger';
import { InMemoryChampionship } from '../../support/in-memory-championship';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { inMemoryEmailMessages, inMemoryEmailOptOuts, inMemoryEmailSuppressions, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';

/** 2 January 2026, US Eastern: 2025 is over. */
const NOW = new Date('2026-01-02T15:00:00.000Z');

class InMemoryYearReviews implements LeagueYearReviewRepository {
  readonly rows: LeagueYearReview[] = [];

  async findByLeagueYear(leagueId: string, year: number): Promise<LeagueYearReview | null> {
    return this.rows.find((row) => row.leagueId === leagueId && row.year === year) ?? null;
  }

  async create(review: Omit<LeagueYearReview, 'sentAt'>): Promise<LeagueYearReview | null> {
    if (await this.findByLeagueYear(review.leagueId, review.year) !== null) return null;
    const row = { ...review, sentAt: NOW };
    this.rows.push(row);
    return row;
  }
}

/** The row's own squad, which the email reads from the squad year, not the row. */
const ROW_SQUAD = { id: 'row-squad', name: 'Row squad' } as Squad;

function standing(position: number, points: number, finishes: number[], played: number): ChampionshipStandingView {
  return {
    squad: ROW_SQUAD,
    position,
    displayPosition: String(position),
    points,
    finishes: [...finishes, ...Array<number>(10 - finishes.length).fill(0)],
    podiums: 0,
    topTens: 0,
    played,
    movement: null,
  };
}

function cup(sportLeagueName: string, status: CupStatus, squadCount: number): CupView {
  return {
    cup: {
      id: `cup-${sportLeagueName}`,
      leagueId: 'league',
      seasonYear: 2025,
      sportLeagueId: `sl-${sportLeagueName}`,
      status,
      crownedAt: null,
      crownedPointsTable: null,
      createdAt: NOW,
    },
    sportLeagueName,
    standings: Array.from({ length: squadCount }, () => ({}) as CupView['standings'][number]),
    contests: [],
  };
}

describe('YearReviewService', () => {
  let world: InMemoryContestWorld;
  let outbox: InMemoryEmailMessages;
  let finishes: InMemoryChampionship;
  let reviews: InMemoryYearReviews;
  let squadYears: SquadYearView[];
  let league: League;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    finishes = new InMemoryChampionship();
    reviews = new InMemoryYearReviews();
    squadYears = [];
    league = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
  });

  function service(email?: Pick<EmailService, 'send'>): YearReviewService {
    const logger = fakeLogger();
    return new YearReviewService({
      reviews,
      finishes,
      history: { getLeagueSquadYears: async () => squadYears },
      leagues: world.leagueRepo(),
      memberships: world.membershipRepo(),
      squadMemberships: world.squadMembershipRepo(),
      users: world.userRepo(),
      email: email ?? new EmailService({
        messages: outbox,
        providerName: 'smtp',
        readConfig: () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }),
        senderAddress: 'noreply@poolmaster.test',
        suppressions: inMemoryEmailSuppressions(),
        optOuts: inMemoryEmailOptOuts(),
        unsubscribe: TEST_UNSUBSCRIBE,
        logger,
      }),
      appBaseUrl: 'https://app.example.test/',
      logger,
      now: () => NOW,
    });
  }

  function countedFinish(year: number, weight: CupWeight = CupWeight.NORMAL): void {
    finishes.finishes.push({
      leagueId: league.id,
      year,
      squadId: 'any',
      contestId: `contest-${String(finishes.finishes.length)}`,
      place: 1,
      tiedCount: 1,
      rankedEntryCount: 4,
      weight,
      points: 100,
      settledAt: NOW,
    });
  }

  /** A squad with one active owner, its 2025 in the championship and cups. */
  function owner(firstName: string, squadName: string, year: Omit<SquadYearView, 'squad' | 'year'>): { userId: string; squad: Squad } {
    const user = world.addUser({ firstName, lastName: 'Owner' });
    world.addMember(league.id, user.id);
    const squad = world.addSquad(league.id, squadName);
    world.addSquadMember(squad.id, user.id);
    squadYears.push({ squad, year: 2025, ...year });
    return { userId: user.id, squad };
  }

  function sentTo(userId: string): { subject: string; text: string } | undefined {
    const row = outbox.rows.find((candidate) => candidate.templateKey === 'YEAR_IN_REVIEW' && candidate.recipientUserId === userId);
    return row === undefined ? undefined : { subject: row.subject ?? '', text: row.textBody ?? '' };
  }

  it('is ready to send last year once its championship has a counted contest, and has nothing to send for a year of only uncounted contests', async () => {
    countedFinish(2024);
    countedFinish(2025, CupWeight.NOT_COUNTED);
    expect(await service().getLastYear(league.id)).toEqual({ year: 2025, status: YearReviewStatus.NOTHING_TO_SEND, sentAt: null, sentBy: null });

    countedFinish(2025);
    expect(await service().getLastYear(league.id)).toEqual({ year: 2025, status: YearReviewStatus.READY, sentAt: null, sentBy: null });
  });

  it('emails each active owner of a squad that placed its own year, with its championship place and trophy, medals and the cups it placed in, then is SENT by the commissioner', async () => {
    countedFinish(2025);
    const commissioner = world.addUser({ firstName: 'Casey', lastName: 'Commish' });
    world.addMember(league.id, commissioner.id, { role: LeagueRole.COMMISSIONER });
    const eaglesYear: Omit<SquadYearView, 'squad' | 'year'> = {
      championship: {
        cupName: 'Office League Cup',
        isOver: true,
        standing: standing(2, 6125, [4, 2, 1], 18),
        squadCount: 12,
        pointsBehindLeader: 100,
        contestsCounted: 20,
        contestsToGo: 0,
      },
      cups: [
        { view: cup('NFL', CupStatus.CROWNED, 12), contestsCounted: 4, standing: { ...standing(1, 2400, [], 0), wins: 2, podiums: 3, contestsCounted: 4, pointsAfter: [], trophy: CupTrophy.CHAMPION } },
        { view: cup('PGA Tour', CupStatus.OPEN, 12), contestsCounted: 3, standing: { ...standing(5, 0, [], 0), displayPosition: 'T5', wins: 0, podiums: 0, contestsCounted: 0, pointsAfter: [], trophy: null } },
      ],
    };
    const eagles = owner('Erin', 'Eagles', eaglesYear);
    const idle = owner('Ivy', 'Idlers', { championship: null, cups: [] });
    const leaver = owner('Lee', 'Leavers', eaglesYear);
    for (const membership of world.memberships.values()) {
      if (membership.userId === leaver.userId) world.memberships.set(membership.id, { ...membership, status: LeagueMembershipStatus.INACTIVE });
    }

    const view = await service().send(league.id, 2025, commissioner.id);

    expect(view).toMatchObject({ year: 2025, status: YearReviewStatus.SENT, sentAt: NOW, sentBy: { id: commissioner.id } });
    const email = sentTo(eagles.userId);
    expect(email?.subject).toBe('Eagles\' 2025 in Office League');
    expect(email?.text).toContain('2025 Office League Cup: 2nd of 12, 612.5 points · Runner-up');
    expect(email?.text).toContain('1sts: 4\n2nds: 2\n3rds: 1\nContests played: 18');
    expect(email?.text).toContain('2025 NFL Cup: 1st of 12, 240 points · Champion');
    // A cup the squad has a 0-point row in is no place of its.
    expect(email?.text).not.toContain('PGA Tour');
    expect(email?.text).toContain('See your 2025: https://app.example.test/league/OFFICE24/team?year=2025');
    // A squad that placed in nothing gets nothing; nor does an owner who left the league.
    expect(sentTo(idle.userId)).toBeUndefined();
    expect(sentTo(leaver.userId)).toBeUndefined();
    expect(sentTo(commissioner.id)).toBeUndefined();
  });

  it('refuses this year, a year already sent and a year with nothing counted, sending no email', async () => {
    countedFinish(2025);
    const sender = world.addUser({ firstName: 'Casey' });
    await expect(service().send(league.id, 2026, sender.id)).rejects.toBeInstanceOf(YearReviewNotOpenError);
    await service().send(league.id, 2025, sender.id);
    await expect(service().send(league.id, 2025, sender.id)).rejects.toBeInstanceOf(YearReviewAlreadySentError);

    const quiet = world.addLeague({ name: 'Quiet League' });
    await expect(service().send(quiet.id, 2025, sender.id)).rejects.toBeInstanceOf(YearReviewNothingToSendError);
    expect(outbox.rows).toEqual([]);
  });

  it('records nothing when an email fails partway, so the commissioner can press Send again', async () => {
    countedFinish(2025);
    const sender = world.addUser({ firstName: 'Casey' });
    owner('Erin', 'Eagles', { championship: { cupName: 'Office League Cup', isOver: true, standing: standing(1, 100, [1], 1), squadCount: 2, pointsBehindLeader: 0, contestsCounted: 1, contestsToGo: 0 }, cups: [] });
    const failing = { send: jest.fn().mockRejectedValue(new Error('outbox down')) };

    await expect(service(failing).send(league.id, 2025, sender.id)).rejects.toThrow('outbox down');

    expect(reviews.rows).toEqual([]);
    expect((await service().getLastYear(league.id)).status).toBe(YearReviewStatus.READY);
  });
});
