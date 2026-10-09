import { SquadMembershipStatus } from '@poolmaster/shared/domain';
import type { SquadDto } from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';

export type TeamDirectoryRow = {
  team: SquadDto;
  /** The team's active owners, by name, joined for display and search. */
  ownerNames: string;
};

export function buildTeamDirectoryRows(teams: readonly SquadDto[]): TeamDirectoryRow[] {
  return teams.map((team) => ({
    team,
    ownerNames: (team.members ?? [])
      .filter((member) => member.status === SquadMembershipStatus.ACTIVE)
      .map((member) => formatUserName(member.user.firstName, member.user.lastName))
      .join(', '),
  }));
}
