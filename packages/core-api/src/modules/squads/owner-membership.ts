import type { SquadMembershipRepository, SquadRepository } from '@poolmaster/shared/db';
import { SquadMembershipStatus, SquadStatus } from '@poolmaster/shared/domain';

interface DeactivateSquadMembershipForLeagueMemberInput {
  leagueId: string;
  userId: string;
  squadRepo: SquadRepository;
  squadMembershipRepo: SquadMembershipRepository;
}

export async function deactivateSquadMembershipForLeagueMember(
  input: DeactivateSquadMembershipForLeagueMemberInput,
): Promise<void> {
  const membership = await input.squadMembershipRepo.findByLeagueAndUser(input.leagueId, input.userId);
  if (!membership || membership.status !== SquadMembershipStatus.ACTIVE) {
    return;
  }

  await input.squadMembershipRepo.update(membership.id, {
    status: SquadMembershipStatus.INACTIVE,
  });

  const remainingOwners = await input.squadMembershipRepo.findBySquad(membership.squadId);
  if (remainingOwners.length === 0) {
    await input.squadRepo.update(membership.squadId, {
      status: SquadStatus.INACTIVE,
    });
  }
}
