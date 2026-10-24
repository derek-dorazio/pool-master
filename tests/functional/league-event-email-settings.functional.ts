import { randomUUID } from 'node:crypto';
import {
  acceptInvitation,
  generateInviteLink,
  listSportLeagues,
  updateLeagueEventEmailSettings,
} from '@poolmaster/shared/generated/hey-api';
import { LeagueResponseSchema } from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// Which sport leagues' upcoming events a league's commissioners are emailed about (#851): the
// commissioner mutes sport leagues through the real route, the choice is saved on the league, and
// an unknown id or a plain member is refused.

const RUN = `event-emails-${Date.now()}`;

afterAll(async () => {
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: league event email settings (#851)', () => {
  it('lets the commissioner mute sport leagues, saving each once on the league, and refuses an unknown sport league and a plain member', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Muted Bell', leagueName: `Quiet Leagues ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Plain Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    const [first, second] = expectDefined((await listSportLeagues({ client: commissioner.client })).data).sportLeagues;
    const muteFirst = expectDefined(first).id;
    const muteSecond = expectDefined(second).id;

    const saved = await updateLeagueEventEmailSettings({
      client: commissioner.client,
      path: { id: league.id },
      body: { mutedSportLeagueIds: [muteFirst, muteSecond, muteFirst] },
    });
    expect(saved.response.status).toBe(200);
    expect(LeagueResponseSchema.parse(expectDefined(saved.data)).league.mutedSportLeagueIds).toEqual([muteFirst, muteSecond]);
    const stored = await getFunctionalPrisma().league.findUniqueOrThrow({ where: { id: league.id }, select: { mutedSportLeagueIds: true } });
    expect(stored.mutedSportLeagueIds).toEqual([muteFirst, muteSecond]);

    const unknown = await updateLeagueEventEmailSettings({
      client: commissioner.client,
      path: { id: league.id },
      body: { mutedSportLeagueIds: [randomUUID()] },
    });
    expect(unknown.response.status).toBe(400);
    expect(unknown.error?.error.code).toBe('SPORT_LEAGUE_NOT_FOUND');

    const byMember = await updateLeagueEventEmailSettings({
      client: member.client,
      path: { id: league.id },
      body: { mutedSportLeagueIds: [] },
    });
    expect(byMember.response.status).toBe(403);
    const unchanged = await getFunctionalPrisma().league.findUniqueOrThrow({ where: { id: league.id }, select: { mutedSportLeagueIds: true } });
    expect(unchanged.mutedSportLeagueIds).toEqual([muteFirst, muteSecond]);
  });
});
