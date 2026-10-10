import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  LeagueMembershipRepository,
  MembershipTransaction,
  SquadMembershipRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import type { SquadDto, SquadMembershipDto } from '@poolmaster/shared/dto';
import { toSquadDto, toSquadMembershipDto } from '../../mappers/squads.mapper';
import { SquadNotFoundError, SquadOperationError } from './errors';
import { assertSquadNameAvailable, resolveAvailableDefaultSquadName } from './squad-name';
import {
  inactivateLeagueMemberUnit,
  LastCommissionerError,
  requireAnotherActiveCommissioner,
} from '../leagues/member-lifecycle';
import { revokePendingOwnerInvitations } from './owner-membership';

/**
 * #202 step 3.4 — `SquadViewerContext` is gone. It threaded
 * `{ userId, isRootAdmin, teamRelationship }` through every read and write in this file so
 * that `toSquadDto` could stamp the viewer's relationship onto each squad. Access rule A8
 * removed those fields from `SquadDto`, so what the two guards below return is nothing: they
 * are authorization checks, and they now say so by name.
 */

interface CreateSquadInput {
  name?: string;
  iconKey?: TeamIconKey;
}

interface UpdateSquadInput {
  name?: string;
  iconKey?: TeamIconKey;
}

export interface SquadServiceDeps {
  squads: SquadRepository;
  squadMemberships: SquadMembershipRepository;
  leagueMemberships: LeagueMembershipRepository;
  users: UserRepository;
  prisma: PrismaClient;
  membershipTransaction: MembershipTransaction;
  logger?: FastifyBaseLogger;
}

export class SquadService {
  private readonly squadRepo: SquadRepository;
  private readonly squadMembershipRepo: SquadMembershipRepository;
  private readonly leagueMembershipRepo: LeagueMembershipRepository;
  private readonly users: UserRepository;
  private readonly prisma: PrismaClient;
  private readonly membershipTransaction: MembershipTransaction;
  private readonly logger?: FastifyBaseLogger;

  constructor(deps: SquadServiceDeps) {
    this.squadRepo = deps.squads;
    this.squadMembershipRepo = deps.squadMemberships;
    this.leagueMembershipRepo = deps.leagueMemberships;
    this.users = deps.users;
    this.prisma = deps.prisma;
    this.membershipTransaction = deps.membershipTransaction;
    this.logger = deps.logger;
  }

  async listSquads(leagueId: string, userId: string, isRootAdmin = false): Promise<SquadDto[]> {
    this.logger?.debug({
      action: 'squad.list.enter',
      data: { leagueId, userId },
    }, 'Listing squads');
    await this.requireLeagueAccess(leagueId, userId, isRootAdmin);

    const squads = await this.squadRepo.findByLeague(leagueId, true);
    const result = await Promise.all(squads.map(async (squad) => this.loadSquadDto(squad.id)));
    this.logger?.info({
      action: 'squad.list.success',
      data: { leagueId, userId, squadCount: result.length },
    }, 'Listed squads');
    return result;
  }

  async getSquad(leagueId: string, squadId: string, userId: string, isRootAdmin = false): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.get.enter',
      data: { leagueId, squadId, userId },
    }, 'Loading squad');
    await this.requireLeagueAccess(leagueId, userId, isRootAdmin);
    await this.requireLeagueScopedSquad(leagueId, squadId);
    const squad = await this.loadSquadDto(squadId);
    this.logger?.info({
      action: 'squad.get.success',
      data: { leagueId, squadId, userId },
    }, 'Loaded squad');
    return squad;
  }

  async createSquad(leagueId: string, userId: string, input: CreateSquadInput): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.create.enter',
      data: { leagueId, userId, hasName: Boolean(input.name?.trim()), iconKey: input.iconKey ?? null },
    }, 'Creating squad');
    await this.requireActiveLeagueMembership(leagueId, userId);
    await this.ensureUserCanJoinLeagueSquad(leagueId, userId);

    const user = await this.requireUser(userId);
    // #202 — squad names are unique per league. A name the user typed must be rejected on
    // collision; the default name must not be able to block them, so it disambiguates.
    const requestedName = input.name?.trim();
    let name: string;
    if (requestedName) {
      await assertSquadNameAvailable(this.squadRepo, leagueId, requestedName);
      name = requestedName;
    } else {
      name = await resolveAvailableDefaultSquadName(
        this.squadRepo,
        leagueId,
        user.firstName,
        user.lastName,
      );
    }
    const squad = await this.squadRepo.create({
      leagueId,
      createdBy: userId,
      name,
      iconKey: input.iconKey ?? TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
    });

    await this.squadMembershipRepo.create({
      squadId: squad.id,
      leagueId,
      userId,
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });

    const squadDto = await this.loadSquadDto(squad.id);
    this.logger?.info({
      action: 'squad.create.success',
      data: { leagueId, squadId: squad.id, userId },
    }, 'Created squad');
    return squadDto;
  }

  async updateSquad(
    leagueId: string,
    squadId: string,
    userId: string,
    input: UpdateSquadInput,
    isRootAdmin = false,
  ): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.update.enter',
      data: {
        leagueId,
        squadId,
        userId,
        updates: {
          nameChanged: input.name !== undefined,
          iconChanged: input.iconKey !== undefined,
        },
      },
    }, 'Updating squad');
    await this.requireSquadManager(leagueId, squadId, userId, isRootAdmin);
    const nextName = input.name?.trim();
    if (nextName === '') {
      // The DTO's min(1) admits a name of only spaces, which trims to nothing.
      this.logger?.warn({
        action: 'squad.update.blankName',
        data: { leagueId, squadId, userId },
      }, 'Rejected blank squad name');
      throw new SquadOperationError('Team name cannot be blank', 'SQUAD_NAME_REQUIRED');
    }
    if (nextName !== undefined) {
      // excludeSquadId so a no-op rename does not collide with itself (#202).
      await assertSquadNameAvailable(this.squadRepo, leagueId, nextName, {
        excludeSquadId: squadId,
      });
    }
    await this.squadRepo.update(squadId, {
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(input.iconKey !== undefined ? { iconKey: input.iconKey } : {}),
    });
    const squad = await this.loadSquadDto(squadId);
    this.logger?.info({
      action: 'squad.update.success',
      data: { leagueId, squadId, userId },
    }, 'Updated squad');
    return squad;
  }

  /**
   * Inactivate a squad. **Commissioner or root admin only (#219).**
   *
   * It used to be `requireSquadManager`, which also admits an owner of the squad. #218 made that
   * consequential rather than merely generous: inactivating a squad ends its owners' league
   * memberships, so a sole owner could remove themselves from the league by inactivating their own
   * team — a destructive, non-obvious side effect of a button on their own team page.
   *
   * Inviting or removing a co-owner stays owner-accessible, because that is plainly the owner's
   * business. Ending a team, and with it somebody's league membership, is league administration.
   */
  async inactivateSquad(
    leagueId: string,
    squadId: string,
    userId: string,
    isRootAdmin = false,
  ): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.inactivate.enter',
      data: { leagueId, squadId, userId },
    }, 'Inactivating squad');
    await this.requireCommissioner(leagueId, squadId, userId, isRootAdmin);
    const squad = await this.requireLeagueScopedSquad(leagueId, squadId);
    if (!squad.isActive) {
      this.logger?.warn({
        action: 'squad.inactivate.alreadyInactive',
        data: { leagueId, squadId, userId },
      }, 'Squad already inactive');
      return this.loadSquadDto(squadId);
    }

    const activeMemberships = await this.squadMembershipRepo.findBySquad(squadId);

    await this.requireCommissionerOutsideSquad(leagueId, squadId, activeMemberships.map((m) => m.userId));

    // One transaction, so the team, every owner's memberships and its invitations end together.
    // Sequential: an interactive transaction runs one statement at a time.
    await this.membershipTransaction.run(async (repos) => {
      for (const membership of activeMemberships) {
        await inactivateLeagueMemberUnit({
          leagueId,
          userId: membership.userId,
          membershipRepo: repos.leagueMemberships,
          squadRepo: repos.squads,
          squadMembershipRepo: repos.squadMemberships,
          logger: this.logger,
        });
      }

      const refreshedSquad = await repos.squads.findById(squadId);
      if (refreshedSquad?.isActive) {
        await repos.squads.update(squadId, { isActive: false });
      }

      await revokePendingOwnerInvitations({
        leagueId,
        squadId,
        ownerInvitationRepo: repos.squadOwnerInvitations,
        logger: this.logger,
      });
    });

    const squadDto = await this.loadSquadDto(squadId);
    this.logger?.info({
      action: 'squad.inactivate.success',
      data: { leagueId, squadId, userId },
    }, 'Inactivated squad');
    return squadDto;
  }

  async addOwner(
    leagueId: string,
    squadId: string,
    actorUserId: string,
    targetUserId: string,
    isRootAdmin = false,
  ): Promise<SquadMembershipDto> {
    this.logger?.debug({
      action: 'squad.addOwner.enter',
      data: { leagueId, squadId, actorUserId, targetUserId },
    }, 'Adding squad owner');
    const squad = await this.requireLeagueScopedSquad(leagueId, squadId);
    await this.requireSquadManager(leagueId, squadId, actorUserId, isRootAdmin);
    await this.requireActiveLeagueMembership(leagueId, targetUserId);

    const existingLeagueMembership = await this.squadMembershipRepo.findByLeagueAndUser(leagueId, targetUserId);
    if (existingLeagueMembership) {
      if (existingLeagueMembership.squadId !== squadId) {
        this.logger?.warn({
          action: 'squad.addOwner.conflict',
          data: { leagueId, squadId, actorUserId, targetUserId, existingSquadId: existingLeagueMembership.squadId },
        }, 'Cannot add owner who already belongs to another squad');
        throw new SquadOperationError(
          'User already belongs to another squad in this league',
          'SQUAD_MEMBERSHIP_CONFLICT',
        );
      }

      if (existingLeagueMembership.status === SquadMembershipStatus.ACTIVE) {
        this.logger?.info({
          action: 'squad.addOwner.alreadyActive',
          data: { leagueId, squadId, actorUserId, targetUserId },
        }, 'Owner already active in squad');
        return this.loadSquadMembershipDto(existingLeagueMembership);
      }

      const reactivated = await this.squadMembershipRepo.update(existingLeagueMembership.id, {
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
      if (!squad.isActive) {
        await this.squadRepo.update(squadId, { isActive: true });
      }
      this.logger?.info({
        action: 'squad.addOwner.reactivated',
        data: { leagueId, squadId, actorUserId, targetUserId },
      }, 'Reactivated historical squad owner');
      return this.loadSquadMembershipDto(reactivated);
    }

    const created = await this.squadMembershipRepo.create({
      squadId,
      leagueId,
      userId: targetUserId,
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });
    const membershipDto = await this.loadSquadMembershipDto(created);
    this.logger?.info({
      action: 'squad.addOwner.success',
      data: { leagueId, squadId, actorUserId, targetUserId },
    }, 'Added squad owner');
    return membershipDto;
  }

  async removeOwner(
    leagueId: string,
    squadId: string,
    actorUserId: string,
    targetUserId: string,
    isRootAdmin = false,
  ): Promise<SquadMembershipDto> {
    this.logger?.debug({
      action: 'squad.removeOwner.enter',
      data: { leagueId, squadId, actorUserId, targetUserId },
    }, 'Removing squad owner');
    await this.requireSquadManager(leagueId, squadId, actorUserId, isRootAdmin);
    const membership = await this.squadMembershipRepo.findBySquadAndUser(squadId, targetUserId);
    if (!membership || membership.status !== SquadMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'squad.removeOwner.notFound',
        data: { leagueId, squadId, actorUserId, targetUserId },
      }, 'Cannot remove missing active squad owner');
      throw new SquadNotFoundError(`Active squad membership not found for user ${targetUserId}`);
    }

    const activeMemberships = (await this.squadMembershipRepo.findBySquad(squadId)).filter(
      (item) => item.status === SquadMembershipStatus.ACTIVE,
    );
    if (activeMemberships.length <= 1) {
      this.logger?.warn({
        action: 'squad.removeOwner.requiresMultipleOwners',
        data: { leagueId, squadId, actorUserId, targetUserId },
      }, 'Rejected remove owner because the team only has one active owner');
      throw new SquadOperationError(
        'This team only has one active owner. Inactivate the team instead.',
        'SQUAD_OWNER_REMOVE_REQUIRES_MULTIPLE_OWNERS',
      );
    }

    /*
     * #218 — removing a co-owner from a squad also ends their LEAGUE membership.
     *
     * The repo owner's decision: "This should also remove the league membership as well. If the
     * desire is to have a new team, they can be re-invited by the commissioner to create a new
     * team." Before this, the squad membership went INACTIVE and the league membership stayed
     * ACTIVE — leaving a league member with no squad, who therefore vanished from every surface
     * that lists people in the league while keeping league access.
     *
     * It routes through the shared unit rather than writing both rows here, so squad-owner
     * removal, league-member removal and squad inactivation all end a membership the same way.
     * That unit no longer touches the user's account, so the invitee can still sign in and
     * accept a re-invitation — which restores their original squad, contest history intact.
     */
    await this.requireAnotherActiveCommissioner(leagueId, targetUserId);
    await this.membershipTransaction.run(async (repos) => inactivateLeagueMemberUnit({
      leagueId,
      userId: targetUserId,
      membershipRepo: repos.leagueMemberships,
      squadRepo: repos.squads,
      squadMembershipRepo: repos.squadMemberships,
      logger: this.logger,
    }));

    const updated = await this.squadMembershipRepo.findBySquadAndUser(squadId, targetUserId);
    if (!updated) {
      throw new SquadNotFoundError(
        `Squad membership vanished while removing user ${targetUserId}`,
      );
    }

    const membershipDto = await this.loadSquadMembershipDto(updated);
    this.logger?.info({
      action: 'squad.removeOwner.success',
      data: { leagueId, squadId, actorUserId, targetUserId },
    }, 'Removed squad owner and ended their league membership');
    return membershipDto;
  }

  async deleteInactiveSquad(
    leagueId: string,
    squadId: string,
    userId: string,
  ): Promise<void> {
    this.logger?.debug({
      action: 'squad.delete.enter',
      data: { leagueId, squadId, userId },
    }, 'Deleting inactive squad');
    const squad = await this.requireLeagueScopedSquad(leagueId, squadId);
    if (squad.isActive) {
      this.logger?.warn({
        action: 'squad.delete.requiresInactive',
        data: { leagueId, squadId, userId },
      }, 'Rejected squad delete because team is still active');
      throw new SquadOperationError(
        'Team must already be inactive before it can be permanently deleted.',
        'SQUAD_DELETE_REQUIRES_INACTIVE',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const entryIds = (
        await tx.contestEntry.findMany({
          where: { squadId },
          select: { id: true },
        })
      ).map((entry) => entry.id);

      if (entryIds.length > 0) {
        await tx.contestEntryPick.deleteMany({
          where: {
            entryId: { in: entryIds },
          },
        });
        await tx.contestEntry.deleteMany({
          where: {
            id: { in: entryIds },
          },
        });
      }

      await tx.squadOwnerInvitation.deleteMany({
        where: { squadId },
      });
      await tx.squadMembership.deleteMany({
        where: { squadId },
      });
      await tx.squad.delete({
        where: { id: squadId },
      });
    });

    this.logger?.info({
      action: 'squad.delete.success',
      data: { leagueId, squadId, userId },
    }, 'Deleted inactive squad');
  }

  /**
   * #218 — the same rule `MemberService` applies, translated into this module's error type.
   *
   * It matters here because a co-owner can be the league's last commissioner while sitting on
   * somebody else's squad: removing them from that squad would now end their league membership
   * and leave the league with nobody who can administer it.
   */
  private async requireAnotherActiveCommissioner(
    leagueId: string,
    targetUserId: string,
  ): Promise<void> {
    try {
      await requireAnotherActiveCommissioner({
        leagueId,
        targetUserId,
        membershipRepo: this.leagueMembershipRepo,
        logger: this.logger,
      });
    } catch (err) {
      if (err instanceof LastCommissionerError) {
        throw new SquadOperationError(err.message, err.code);
      }
      throw err;
    }
  }

  /**
   * Inactivating a team ends every owner's league membership, so it must not take the league's
   * last active commissioner with it — the rule `removeOwner` applies to one owner (#218),
   * applied to all of the team's owners at once.
   */
  private async requireCommissionerOutsideSquad(
    leagueId: string,
    squadId: string,
    ownerUserIds: string[],
  ): Promise<void> {
    const owners = new Set(ownerUserIds);
    const commissioners = (await this.leagueMembershipRepo.findByLeague(leagueId)).filter(
      (membership) =>
        membership.status === LeagueMembershipStatus.ACTIVE && membership.role === LeagueRole.COMMISSIONER,
    );
    if (commissioners.length === 0 || commissioners.some((membership) => !owners.has(membership.userId))) {
      return;
    }
    this.logger?.warn({
      action: 'squad.inactivate.lastCommissioner',
      data: { leagueId, squadId },
    }, 'Rejected inactivating the team of the league\'s last active commissioner');
    const lastCommissioner = new LastCommissionerError();
    throw new SquadOperationError(lastCommissioner.message, lastCommissioner.code);
  }

  private async loadSquadDto(squadId: Promise<string> | string): Promise<SquadDto> {
    const resolvedSquadId = await squadId;
    const squad = await this.squadRepo.findById(resolvedSquadId);
    if (!squad) {
      throw new SquadNotFoundError(`Squad not found: ${resolvedSquadId}`);
    }
    const memberships = await this.squadMembershipRepo.findBySquad(resolvedSquadId, true);
    // #202 step 3.4 — the squad's members come off `UserRepository.findByLeague`, the scoped
    // peer read A4 and A6 require, rather than a raw `findMany` selecting three columns. The
    // edge embeds the whole `UserDto`, so three columns are no longer enough.
    const leagueUsers = memberships.length === 0 ? [] : await this.users.findByLeague(squad.leagueId);
    const userByUserId = new Map(leagueUsers.map((user) => [user.id, user]));
    const memberDtos = memberships.flatMap((membership) => {
      const user = userByUserId.get(membership.userId);
      return user ? [toSquadMembershipDto(membership, user)] : [];
    });
    const memberCount = memberships.filter(
      (membership) => membership.status === SquadMembershipStatus.ACTIVE,
    ).length;
    return toSquadDto(squad, memberCount, memberDtos);
  }

  private async loadSquadMembershipDto(membership: {
    id: string;
    squadId: string;
    leagueId: string;
    userId: string;
    status: SquadMembershipStatus;
    joinedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<SquadMembershipDto> {
    const user = await this.requireUser(membership.userId);
    return toSquadMembershipDto(membership, user);
  }

  private async requireLeagueScopedSquad(leagueId: string, squadId: string) {
    const squad = await this.squadRepo.findById(squadId);
    if (!squad || squad.leagueId !== leagueId) {
      this.logger?.warn({
        action: 'squad.requireScoped.notFound',
        data: { leagueId, squadId },
      }, 'Requested squad was not found in league scope');
      throw new SquadNotFoundError(`Squad not found: ${squadId}`);
    }
    return squad;
  }

  private async requireActiveLeagueMembership(leagueId: string, userId: string) {
    const membership = await this.leagueMembershipRepo.findByLeagueAndUser(leagueId, userId);
    if (!membership || membership.status !== LeagueMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'squad.requireLeagueMembership.missing',
        data: {
          leagueId,
          userId,
          reason: membership ? `status:${membership.status}` : 'membership_missing',
        },
      }, 'Rejected squad action for non-active league member');
      throw new SquadOperationError(
        'You must be an active league member to manage squads',
        'LEAGUE_MEMBERSHIP_REQUIRED',
      );
    }
    return membership;
  }

  /**
   * Access rule A4 — reading a league's squads requires an active membership in it, which a
   * root admin bypasses (A1). Returns nothing: the answer is "you may proceed or you may not".
   */
  private async requireLeagueAccess(
    leagueId: string,
    userId: string,
    isRootAdmin: boolean,
  ): Promise<void> {
    if (isRootAdmin) {
      return;
    }
    await this.requireActiveLeagueMembership(leagueId, userId);
  }

  private async requireActiveSquadOwner(leagueId: string, squadId: string, userId: string) {
    await this.requireLeagueScopedSquad(leagueId, squadId);
    const membership = await this.squadMembershipRepo.findBySquadAndUser(squadId, userId);
    if (!membership || membership.status !== SquadMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'squad.requireOwner.missing',
        data: {
          leagueId,
          squadId,
          userId,
          reason: membership ? `status:${membership.status}` : 'membership_missing',
        },
      }, 'Rejected squad action for non-owner');
      throw new SquadOperationError(
        'You must be an active team owner to perform this action',
        'SQUAD_OWNER_REQUIRED',
      );
    }
    if (membership.leagueId !== leagueId) {
      this.logger?.warn({
        action: 'squad.requireOwner.leagueMismatch',
        data: { leagueId, squadId, userId, membershipLeagueId: membership.leagueId },
      }, 'Rejected squad action due to league mismatch');
      throw new SquadOperationError(
        'Squad membership does not match the requested league',
        'SQUAD_LEAGUE_MISMATCH',
      );
    }
    return membership;
  }

  /**
   * Access rule A7 — a squad is managed by one of its owners, by a commissioner of its
   * league acting on a member's behalf, or by a root admin. Returns nothing.
   */
  /**
   * Commissioner or root admin, for squad operations that are league administration rather than
   * team management (#219). Narrower than `requireSquadManager`, which also admits the squad's own
   * owners.
   */
  private async requireCommissioner(
    leagueId: string,
    squadId: string,
    userId: string,
    isRootAdmin: boolean,
  ): Promise<void> {
    if (isRootAdmin) {
      await this.requireLeagueScopedSquad(leagueId, squadId);
      return;
    }

    const leagueMembership = await this.requireActiveLeagueMembership(leagueId, userId);
    if (leagueMembership.role !== LeagueRole.COMMISSIONER) {
      this.logger?.warn({
        action: 'squad.requireCommissioner.denied',
        data: { leagueId, squadId, userId, role: leagueMembership.role },
      }, 'Rejected commissioner-only squad action');
      throw new SquadOperationError(
        'Only a league commissioner can inactivate a team',
        'LEAGUE_PERMISSION_DENIED',
      );
    }
    await this.requireLeagueScopedSquad(leagueId, squadId);
  }

  private async requireSquadManager(
    leagueId: string,
    squadId: string,
    userId: string,
    isRootAdmin: boolean,
  ): Promise<void> {
    if (isRootAdmin) {
      await this.requireLeagueScopedSquad(leagueId, squadId);
      this.logger?.debug({
        action: 'squad.requireManager.rootAdminBypass',
        data: { leagueId, squadId, userId },
      }, 'Root admin managing squad');
      return;
    }

    const leagueMembership = await this.requireActiveLeagueMembership(leagueId, userId);
    if (leagueMembership.role === LeagueRole.COMMISSIONER) {
      await this.requireLeagueScopedSquad(leagueId, squadId);
      this.logger?.debug({
        action: 'squad.requireManager.commissionerBypass',
        data: { leagueId, squadId, userId },
      }, 'Commissioner managing squad');
      return;
    }

    await this.requireActiveSquadOwner(leagueId, squadId, userId);
  }

  private async ensureUserCanJoinLeagueSquad(leagueId: string, userId: string): Promise<void> {
    const existing = await this.squadMembershipRepo.findByLeagueAndUser(leagueId, userId);
    if (existing && existing.status === SquadMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'squad.ensureJoinable.activeConflict',
        data: { leagueId, userId, squadId: existing.squadId },
      }, 'Rejected squad creation because user already belongs to an active squad');
      throw new SquadOperationError(
        'User already belongs to a squad in this league',
        'SQUAD_MEMBERSHIP_CONFLICT',
      );
    }
    if (existing && existing.status === SquadMembershipStatus.INACTIVE) {
      this.logger?.warn({
        action: 'squad.ensureJoinable.historyExists',
        data: { leagueId, userId, squadId: existing.squadId },
      }, 'Rejected squad creation because user already has squad history');
      throw new SquadOperationError(
        'User already has a squad history in this league',
        'SQUAD_HISTORY_EXISTS',
      );
    }
  }

  private async requireUser(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) {
      this.logger?.warn({
        action: 'squad.requireUser.notFound',
        data: { userId },
      }, 'Cannot resolve squad owner user');
      throw new SquadOperationError(`User not found: ${userId}`, 'USER_NOT_FOUND');
    }
    return user;
  }
}

