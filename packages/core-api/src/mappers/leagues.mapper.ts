/**
 * League mappers — domain/Prisma row → DTO.
 *
 * #202 step 3.4: there is ONE league projection. There used to be two —
 * `toLeagueSummaryDto` and `toLeagueDetailDto`, the second calling the first and adding
 * `joinPolicy` — and both took an options bag of viewer fields (`memberType`,
 * `leagueRelationship`, `isRootAdmin`) that access rule A8 has since removed from the DTO.
 * With the viewer context gone, the only remaining inputs are the league row and its two
 * counts, so the options bag went with them.
 */
import type { LeagueDto } from '@poolmaster/shared/dto';
import type { JoinPolicy, LeagueIconKey } from '@poolmaster/shared/domain';

interface LeagueRow {
  id: string;
  leagueCode: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  iconKey: LeagueIconKey;
  joinPolicy: JoinPolicy;
  createdAt: Date;
  updatedAt: Date;
}

export function toLeagueDto(
  league: LeagueRow,
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
    joinPolicy: league.joinPolicy,
    memberCount: counts?.memberCount ?? 0,
    activeContestCount: counts?.activeContestCount ?? 0,
    createdAt: league.createdAt.toISOString(),
  };
}
