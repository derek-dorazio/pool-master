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

export function toLeagueDto(
  league: League,
  counts?: {
    memberCount?: number;
    activeContestCount?: number;
  },
): LeagueDto {
  return {
    id: league.id,
    leagueCode: league.leagueCode,
    name: league.name,
    description: league.description ?? null,
    isActive: league.isActive,
    iconKey: league.iconKey,
    memberCount: counts?.memberCount ?? 0,
    activeContestCount: counts?.activeContestCount ?? 0,
    createdAt: league.createdAt.toISOString(),
    cupName: league.cupName,
    cupPointsScale: league.cupPointsScale,
    cupCustomPoints: league.cupCustomPoints,
  };
}
