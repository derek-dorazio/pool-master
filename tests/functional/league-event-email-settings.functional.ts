import { randomUUID } from 'node:crypto';
import {
  acceptInvitation,
  generateInviteLink,
  listSportLeagues,
  updateLeagueEventEmailSettings,
} from '@poolmaster/shared/generated/hey-api';
import { EventEmailDelivery } from '@poolmaster/shared/domain';
import { LeagueResponseSchema } from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// How a league's commissioners hear about upcoming events (#851): the commissioner mutes sport
// leagues and picks the weekly digest through the real route, both are saved on the league, and
// an unknown id or a plain member is refused.

const RUN = `event-emails-${Date.now()}`;

afterAll(async () => {
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: league event email settings (#851)', () => {
  it('lets the commissioner mute sport leagues and choose the weekly digest, saving each muted league once on the league, and refuses an unknown sport league and a plain member', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Muted Bell', leagueName: `Quiet Leagues ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Plain Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    const [first, second] = expectDefined((await listSportLeagues({ client: commissioner.client })).data).sportLeagues;
    const muteFirst = expectDefined(first).id;
    const muteSecond = expectDefined(second).id;

    const created = await getFunctionalPrisma().league.findUniqueOrThrow({ where: { id: league.id }, select: { eventEmailDelivery: true } });
    expect(created.eventEmailDelivery).toBe(EventEmailDelivery.PER_EVENT);

    const saved = await updateLeagueEventEmailSettings({
      client: commissioner.client,
      path: { id: league.id },
      body: { mutedSportLeagueIds: [muteFirst, muteSecond, muteFirst], eventEmailDelivery: EventEmailDelivery.WEEKLY_DIGEST },
    });
    expect(saved.response?.status).toBe(200);
    const savedLeague = LeagueResponseSchema.parse(expectDefined(saved.data)).league;
    expect(savedLeague.mutedSportLeagueIds).toEqual([muteFirst, muteSecond]);
    expect(savedLeague.eventEmailDelivery).toBe(EventEmailDelivery.WEEKLY_DIGEST);
    // The saved league carries its real counts, not zeros the web app would cache.
    expect(savedLeague.memberCount).toBe(2);
    const stored = await getFunctionalPrisma().league.findUniqueOrThrow({ where: { id: league.id }, select: { mutedSportLeagueIds: true, eventEmailDelivery: true } });
    expect(stored).toEqual({ mutedSportLeagueIds: [muteFirst, muteSecond], eventEmailDelivery: EventEmailDelivery.WEEKLY_DIGEST });

    const unknown = await updateLeagueEventEmailSettings({
      client: commissioner.client,
      path: { id: league.id },
      body: { mutedSportLeagueIds: [randomUUID()], eventEmailDelivery: EventEmailDelivery.PER_EVENT },
    });
    expect(unknown.response?.status).toBe(400);
    expect(unknown.error?.error.code).toBe('SPORT_LEAGUE_NOT_FOUND');

    const byMember = await updateLeagueEventEmailSettings({
      client: member.client,
      path: { id: league.id },
      body: { mutedSportLeagueIds: [], eventEmailDelivery: EventEmailDelivery.PER_EVENT },
    });
    expect(byMember.response?.status).toBe(403);
    const unchanged = await getFunctionalPrisma().league.findUniqueOrThrow({ where: { id: league.id }, select: { mutedSportLeagueIds: true, eventEmailDelivery: true } });
    expect(unchanged).toEqual({ mutedSportLeagueIds: [muteFirst, muteSecond], eventEmailDelivery: EventEmailDelivery.WEEKLY_DIGEST });
  });
});
