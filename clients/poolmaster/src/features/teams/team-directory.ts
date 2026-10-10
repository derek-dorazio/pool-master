import { SquadMembershipStatus } from '@poolmaster/shared/domain';
import type { SquadDto } from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';

export type TeamDirectoryRow = {
  team: SquadDto;
  /** The team's active owners, by name, joined for display and search. */
  ownerNames: string;
};

/** The team's owners who are still active in the league. */
export function getActiveOwners(team: SquadDto) {
  return (team.members ?? []).filter((member) => member.status === SquadMembershipStatus.ACTIVE);
}

/** "1 owner", "3 owners". */
export function formatOwnerCount(team: SquadDto) {
  const count = getActiveOwners(team).length;
  return `${count} ${count === 1 ? 'owner' : 'owners'}`;
}

export function buildTeamDirectoryRows(teams: readonly SquadDto[]): TeamDirectoryRow[] {
  return teams.map((team) => ({
    team,
    ownerNames: getActiveOwners(team)
      .map((member) => formatUserName(member.user.firstName, member.user.lastName))
      .join(', '),
  }));
}
