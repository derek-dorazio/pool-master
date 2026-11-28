import {
  acceptInvitation,
  generateInviteLink,
  getYearReview,
  sendYearReview,
} from '@poolmaster/shared/generated/hey-api';
import { YearReviewStatus } from '@poolmaster/shared/domain';
import { YearReviewResponseSchema } from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// The year in review (#872 slice 4) through the real routes: the league's latest closed
// championship year (#2021). A new league has none, so nothing to send; a closed year with
// nothing counted has nothing to send either, and members are kept out. Sending is unit tested.

afterAll(async () => {
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: the year in review (#872)', () => {
  it('has nothing to send before a new league closes a year, refuses a year that is not its latest closed one or one with nothing counted, and is for commissioners only', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Review Keeper', leagueName: `Review League ${Date.now()}` });
    const member = await buildRegisteredUser({ displayName: 'Review Reader' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    const review = async () => YearReviewResponseSchema.parse(expectDefined((await getYearReview({ client: commissioner.client, path: { id: league.id } })).data)).yearReview;

    expect(await review()).toEqual({ year: null, status: YearReviewStatus.NOTHING_TO_SEND, sentAt: null, sentByName: null });
    const notClosed = await sendYearReview({ client: commissioner.client, path: { id: league.id, year: 2098 } });
    expect(notClosed.response?.status).toBe(409);
    expect(notClosed.error?.error.code).toBe('YEAR_REVIEW_NOT_OPEN');

    // The league's 2098 year closed, as the year close job leaves it (#2021), with nothing counted in it.
    await getFunctionalPrisma().leagueChampionshipYear.create({ data: { leagueId: league.id, championshipYear: 2098, closedAt: new Date() } });
    expect(await review()).toEqual({ year: 2098, status: YearReviewStatus.NOTHING_TO_SEND, sentAt: null, sentByName: null });
    const nothing = await sendYearReview({ client: commissioner.client, path: { id: league.id, year: 2098 } });
    expect(nothing.response?.status).toBe(409);
    expect(nothing.error?.error.code).toBe('YEAR_REVIEW_NOTHING_TO_SEND');

    expect((await getYearReview({ client: member.client, path: { id: league.id } })).response?.status).toBe(403);
    expect((await sendYearReview({ client: member.client, path: { id: league.id, year: 2098 } })).response?.status).toBe(403);
  });
});
