/**
 * League mappers — domain/Prisma row → DTO.
 *
 * #202 step 3.4: there is ONE league projection. There used to be two —
 * `toLeagueSummaryDto` and `toLeagueDetailDto`, the second calling the first and adding a
 * field — and both took an options bag of viewer fields (`memberType`,
 * `leagueRelationship`, `isRootAdmin`) that access rule A8 has since removed from the DTO.
 * With the viewer context gone, the only remaining inputs are the league row and its two
 * counts, so the options bag went with them.
 */
import type { LeagueDto } from '@poolmaster/shared/dto';
import type { League } from '@poolmaster/shared/domain';
import type { PlanEntitlements } from '../modules/plans/plan-entitlements-service';
import type { LeagueActivityCounts } from '../modules/leagues/service';
import { toPlanEntitlementsDto } from './plans.mapper';

/** `entitlements` is what the league's plan allows now, from the plan entitlements service (#945). */
export function toLeagueDto(
  league: League,
  entitlements: PlanEntitlements,
  /** Required: a response that left them out used to send zeros the client then cached (#1208). */
  counts: LeagueActivityCounts,
): LeagueDto {
  return {
    id: league.id,
    leagueCode: league.leagueCode,
    name: league.name,
    description: league.description ?? null,
    isActive: league.isActive,
    iconKey: league.iconKey,
    memberCount: counts.memberCount,
    activeContestCount: counts.activeContestCount,
    createdAt: league.createdAt.toISOString(),
    cupName: league.cupName,
    cupPointsScale: league.cupPointsScale,
    cupCustomPoints: league.cupCustomPoints,
    hallOfLameVisible: league.hallOfLameVisible,
    planEntitlements: toPlanEntitlementsDto(entitlements),
    planRenewsAt: league.planRenewsAt.toISOString(),
    mutedSportLeagueIds: league.mutedSportLeagueIds,
    eventEmailDelivery: league.eventEmailDelivery,
  };
}
