import { LeagueRole } from '@poolmaster/shared/domain';
import { activeLeagueMembersByLeague, leagueMembersOf } from '../../../packages/core-api/src/modules/notifications/league-members';
import { buildMembership, buildUser } from '../../factories';

// Who a league email goes to (#1255), from rows already read: each active account once per league
// it holds an active membership in, with its role there.

describe('leagueMembersOf', () => {
  it('lists each active account under every league it is a member of, leaves out a closed account and an account with no membership, and gives a league with nobody an empty list', () => {
    const [both, closed, stray] = [buildUser(), buildUser({ isActive: false }), buildUser()];
    const memberships = [
      buildMembership({ leagueId: 'league-1', userId: both.id, role: LeagueRole.COMMISSIONER }),
      buildMembership({ leagueId: 'league-2', userId: both.id, role: LeagueRole.MEMBER }),
      buildMembership({ leagueId: 'league-1', userId: closed.id }),
    ];

    const byLeague = leagueMembersOf(['league-1', 'league-2', 'league-3'], memberships, [both, closed, stray]);

    expect([...byLeague].map(([leagueId, members]) => [leagueId, members.map(({ user, role }) => [user.id, role])])).toEqual([
      ['league-1', [[both.id, LeagueRole.COMMISSIONER]]],
      ['league-2', [[both.id, LeagueRole.MEMBER]]],
      ['league-3', []],
    ]);
  });
});

describe('activeLeagueMembersByLeague', () => {
  it('reads nothing for no leagues', async () => {
    const deps = { memberships: { findByLeagues: jest.fn() }, users: { findActiveByLeagues: jest.fn() } };

    await expect(activeLeagueMembersByLeague(deps, [])).resolves.toEqual(new Map());
    expect(deps.memberships.findByLeagues).not.toHaveBeenCalled();
    expect(deps.users.findActiveByLeagues).not.toHaveBeenCalled();
  });
});
