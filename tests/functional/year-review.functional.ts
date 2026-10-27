import {
  acceptInvitation,
  generateInviteLink,
  getYearReview,
  sendYearReview,
} from '@poolmaster/shared/generated/hey-api';
import { YearReviewStatus, championshipYear } from '@poolmaster/shared/domain';
import { YearReviewResponseSchema } from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// The year in review (#872 slice 4) through the real routes. Last year's finishes can't be made
// through the API (a contest counts in the year it settles), so a new league has nothing to send:
// the routes answer that, refuse this year, and keep members out. Sending is unit tested.

afterAll(async () => {
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: the year in review (#872)', () => {
  it('has nothing to send for last year in a new league, refuses to send this year or a year with nothing counted, and is for commissioners only', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Review Keeper', leagueName: `Review League ${Date.now()}` });
    const member = await buildRegisteredUser({ displayName: 'Review Reader' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    const lastYear = championshipYear(new Date()) - 1;

    const review = YearReviewResponseSchema.parse(expectDefined((await getYearReview({ client: commissioner.client, path: { id: league.id } })).data)).yearReview;
    expect(review).toEqual({ year: lastYear, status: YearReviewStatus.NOTHING_TO_SEND, sentAt: null, sentByName: null });

    const thisYear = await sendYearReview({ client: commissioner.client, path: { id: league.id, year: lastYear + 1 } });
    expect(thisYear.response?.status).toBe(409);
    expect(thisYear.error?.error.code).toBe('YEAR_REVIEW_NOT_OPEN');
    const nothing = await sendYearReview({ client: commissioner.client, path: { id: league.id, year: lastYear } });
    expect(nothing.response?.status).toBe(409);
    expect(nothing.error?.error.code).toBe('YEAR_REVIEW_NOTHING_TO_SEND');

    expect((await getYearReview({ client: member.client, path: { id: league.id } })).response?.status).toBe(403);
    expect((await sendYearReview({ client: member.client, path: { id: league.id, year: lastYear } })).response?.status).toBe(403);
  });
});
