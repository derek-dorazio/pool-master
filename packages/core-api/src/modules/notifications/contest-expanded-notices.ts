/**
 * "Contest expanded" (#987, plans/payments.md §8): when a contest's entry cap is raised, the
 * league's commissioners hear who did it and the new cap, except whoever expanded it. A root
 * admin's free grant names Primetime Commissioner rather than the admin, and every commissioner hears of it.
 *
 * Account category, so always sent. Each expansion is told once: an expansion only ever raises a
 * contest's cap, so the contest and its new cap name it, and that is the outbox subject.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { LeagueRepository } from '@poolmaster/shared/db';
import { LeagueRole, type Contest } from '@poolmaster/shared/domain';
import { buildContestAdminUrl, formatUserName, type EmailService } from '../email';
import { activeLeagueMembersWithRoles, type LeagueMemberDeps } from './league-members';

/** One expansion, as the email tells it. */
export interface ContestExpansionNotice {
  contest: Contest;
  /** The contest's entry cap now. */
  entriesPerContest: number;
  /** Who expanded it; they are not told of their own expansion. */
  expandedById: string;
  /** True for a root admin's free grant, which names Primetime Commissioner rather than the admin. */
  granted: boolean;
}

export interface ContestExpandedNoticeDeps extends LeagueMemberDeps {
  leagues: Pick<LeagueRepository, 'findById'>;
  email: Pick<EmailService, 'send'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

export class ContestExpandedNotices {
  constructor(private readonly deps: ContestExpandedNoticeDeps) {}

  /** The expansion has already been written, so a failure is logged rather than thrown. */
  async tellExpanded(notice: ContestExpansionNotice): Promise<void> {
    const { contest, entriesPerContest, expandedById, granted } = notice;
    try {
      const league = await this.deps.leagues.findById(contest.leagueId);
      if (!league?.isActive) return;
      const members = await activeLeagueMembersWithRoles(this.deps, league.id);
      const expander = members.find(({ user }) => user.id === expandedById)?.user;
      // A root admin outside the league expanding as a commissioner would is named as Primetime Commissioner too.
      const expandedBy = !granted && expander ? formatUserName(expander) : null;
      const contestUrl = buildContestAdminUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
      const commissioners = members.filter(({ user, role }) => role === LeagueRole.COMMISSIONER && user.id !== expandedById);
      for (const { user } of commissioners) {
        await this.deps.email.send('CONTEST_EXPANDED', {
          to: { email: user.email, userId: user.id, timeZone: user.timezone },
          about: `${contest.id}:${String(entriesPerContest)}`,
          league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
          data: {
            userName: formatUserName(user),
            leagueName: league.name,
            contestName: contest.name,
            entriesPerContest,
            expandedBy,
            contestUrl,
          },
        });
      }
    } catch (error) {
      this.deps.logger?.error({
        action: 'email.contestExpanded.failed',
        data: { leagueId: contest.leagueId, contestId: contest.id, entriesPerContest, error: error instanceof Error ? error.message : String(error) },
      }, 'Failed to queue the contest expanded email');
    }
  }
}
