import { LeagueIconKey, LeagueRole, TeamIconKey } from '@poolmaster/shared/domain';
import type { UserDto, DeleteLeagueResponses, GenerateInviteLinkResponse, InvitationPreviewResponse, LeagueContextResponse, LeagueDto, LeagueInvitationDto, LeagueListResponse, LeagueMembershipDto, LeagueMembershipResponse, LeagueResponse, SquadDto, SquadListResponse, SquadResponse } from '@/lib/api';

export type CurrentUser = UserDto;
export type LeagueSquadMember = NonNullable<SquadDto['members']>[number];
export type InvitationPreview = InvitationPreviewResponse['invitation'];
export type AcceptedLeagueMembership = LeagueMembershipDto;
export type GeneratedInviteLink = LeagueInvitationDto;

// #202 — one fixture shape, because there is one `LeagueDto`. This was a summary fixture and a
// detail fixture that extended it, carrying `memberType`, `leagueRelationship` and `isRootAdmin`
// — the viewer context that A8 moved off the entity.
type LeagueFixture = Pick<
  LeagueDto,
  | 'id'
  | 'leagueCode'
  | 'name'
  | 'description'
  | 'isActive'
  | 'iconKey'
  | 'memberCount'
  | 'activeContestCount'
  | 'joinPolicy'
  | 'createdAt'
>;

type CurrentUserFixture = Pick<
  CurrentUser,
  | 'id'
  | 'email'
  | 'username'
  | 'firstName'
  | 'lastName'
  | 'isActive'
  | 'isRootAdmin'
  | 'createdAt'
>;

type LeagueSquadFixture = Pick<
  SquadDto,
  | 'id'
  | 'leagueId'
  | 'createdBy'
  | 'name'
  | 'iconKey'
  | 'isActive'
  | 'memberCount'
  | 'createdAt'
  | 'updatedAt'
  | 'members'
>;

type LeagueSquadMemberFixture = Pick<
  LeagueSquadMember,
  | 'id'
  | 'squadId'
  | 'leagueId'
  | 'userId'
  | 'user'
  | 'status'
  | 'joinedAt'
  | 'createdAt'
  | 'updatedAt'
>;

type InvitationPreviewFixture = Pick<
  InvitationPreview,
  'inviteCode' | 'status' | 'league'
>;

type AcceptedLeagueMembershipFixture = Pick<
  AcceptedLeagueMembership,
  | 'id'
  | 'leagueId'
  | 'userId'
  | 'user'
  | 'role'
  | 'status'
  | 'joinedAt'
  | 'createdAt'
  | 'updatedAt'
>;

type GeneratedInviteLinkFixture = Pick<
  GeneratedInviteLink,
  | 'id'
  | 'leagueId'
  | 'inviteCode'
  | 'inviteType'
  | 'status'
  | 'maxUses'
  | 'currentUses'
  | 'invitedBy'
  | 'createdAt'
  | 'updatedAt'
>;

const baseCurrentUser: CurrentUserFixture = {
  id: 'user-1',
  email: 'commissioner@example.com',
  username: 'commissioner@example.com',
  firstName: 'Casey',
  lastName: 'Commissioner',
  isActive: true,
  isRootAdmin: false,
  createdAt: '2026-04-15T00:00:00.000Z',
};

const baseLeague: LeagueFixture = {
  id: 'league-1',
  leagueCode: 'BIGDAWGS',
  name: 'Big Dawgs',
  description: 'A test league',
  isActive: true,
  iconKey: LeagueIconKey.TROPHY,
  memberCount: 2,
  activeContestCount: 1,
  joinPolicy: 'COMMISSIONER_ONLY',
  createdAt: '2026-04-15T00:00:00.000Z',
};

const baseSquadMember: LeagueSquadMemberFixture = {
  id: 'team-membership-1',
  squadId: 'team-1',
  leagueId: 'league-1',
  userId: 'user-1',
  user: baseCurrentUser,
  status: 'ACTIVE',
  joinedAt: '2026-04-15T00:00:00.000Z',
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
};

const baseLeagueSquad: LeagueSquadFixture = {
  id: 'team-1',
  leagueId: 'league-1',
  createdBy: 'user-1',
  name: 'Casey Crushers',
  iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
  isActive: true,
  memberCount: 1,
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
  members: [baseSquadMember],
};

const baseInvitationPreview: InvitationPreviewFixture = {
  inviteCode: 'LEAGUE123',
  status: 'PENDING',
  league: {
    id: 'league-1',
    leagueCode: 'BIGDAWGS',
    name: 'Big Dawgs',
  },
};

const baseAcceptedMembership: AcceptedLeagueMembershipFixture = {
  id: 'membership-1',
  leagueId: 'league-1',
  userId: 'user-1',
  user: baseCurrentUser,
  role: LeagueRole.MEMBER,
  status: 'ACTIVE',
  joinedAt: '2026-04-16T00:00:00.000Z',
  createdAt: '2026-04-16T00:00:00.000Z',
  updatedAt: '2026-04-16T00:00:00.000Z',
};

const baseGeneratedInviteLink: GeneratedInviteLinkFixture = {
  id: 'invite-1',
  leagueId: 'league-1',
  inviteCode: 'invite-abc',
  inviteType: 'LINK',
  status: 'PENDING',
  maxUses: 1,
  currentUses: 0,
  invitedBy: 'user-1',
  createdAt: '2026-04-16T00:00:00.000Z',
  updatedAt: '2026-04-16T00:00:00.000Z',
};

export function apiSuccess<TData>(data: TData): { data: TData } {
  return { data };
}

export function buildLeague(overrides: Partial<LeagueDto> = {}): LeagueDto {
  return {
    ...baseLeague,
    ...overrides,
  };
}

/**
 * #202 (A8) — the viewer's membership, which used to be a `leagueRelationship` block on the
 * league. `buildLeagueMembership()` is a commissioner because that is what the league fixtures
 * assumed; a member or a non-member is an override or its absence.
 */
export function buildLeagueMembership(
  overrides: Partial<LeagueMembershipDto> = {},
): LeagueMembershipDto {
  return {
    ...baseAcceptedMembership,
    role: LeagueRole.COMMISSIONER,
    ...overrides,
  };
}

export function buildCurrentUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    ...baseCurrentUser,
    ...overrides,
  };
}

export function buildLeagueSquadMember(
  overrides: Partial<LeagueSquadMember> = {},
): LeagueSquadMember {
  return {
    ...baseSquadMember,
    ...overrides,
  };
}

export function buildLeagueSquad(overrides: Partial<SquadDto> = {}): SquadDto {
  return {
    ...baseLeagueSquad,
    ...overrides,
  };
}

export function buildInvitationPreview(
  overrides: Partial<InvitationPreview> = {},
): InvitationPreview {
  return {
    ...baseInvitationPreview,
    ...overrides,
  };
}

export function buildAcceptedLeagueMembership(
  overrides: Partial<AcceptedLeagueMembership> = {},
): AcceptedLeagueMembership {
  return {
    ...baseAcceptedMembership,
    ...overrides,
  };
}

export function buildGeneratedInviteLink(
  overrides: Partial<GeneratedInviteLink> = {},
): GeneratedInviteLink {
  return {
    ...baseGeneratedInviteLink,
    ...overrides,
  };
}

export function listLeaguesData(
  leagues: LeagueDto[],
  memberships: LeagueMembershipDto[] = [],
): LeagueListResponse {
  return { leagues, memberships };
}

export function getLeagueData(league: LeagueDto): LeagueResponse {
  return { league };
}

/**
 * #202 (A8) — the league-context read. It returns the league together with the viewer's own
 * edges in it, once, so nothing downstream repeats them.
 */
export function getLeagueByCodeData(
  league: LeagueDto,
  context: {
    membership?: LeagueMembershipDto | null;
    squadMembership?: LeagueSquadMember | null;
  } = {},
): LeagueContextResponse {
  return {
    league,
    membership: context.membership ?? buildLeagueMembership({ leagueId: league.id }),
    squadMembership: context.squadMembership ?? null,
  };
}

/**
 * #215 — creating a league returns the league context, not a bare league. Creating a league
 * also creates the creator's COMMISSIONER membership, so the 201 carries the same shape the
 * two league reads carry. `squadMembership` is null by construction.
 */
export function createLeagueData(
  league: LeagueDto,
  context: { membership?: LeagueMembershipDto | null } = {},
): LeagueContextResponse {
  return {
    league,
    membership: context.membership ?? buildLeagueMembership({ leagueId: league.id }),
    squadMembership: null,
  };
}

export function updateLeagueDetailsData(
  league: LeagueDto,
): LeagueResponse {
  return { league };
}

export function updateLeagueIconData(
  league: LeagueDto,
): LeagueResponse {
  return { league };
}

export function inactivateLeagueData(
  league: LeagueDto,
): LeagueResponse {
  return { league };
}

export function activateLeagueData(
  league: LeagueDto,
): LeagueResponse {
  return { league };
}

export function deleteLeagueData(): DeleteLeagueResponses[200] {
  return { success: true };
}

export function listLeagueSquadsData(
  squads: SquadDto[],
): SquadListResponse {
  return { squads };
}

export function updateLeagueSquadData(
  squad: SquadDto,
): SquadResponse {
  return { squad };
}

export function generateInviteLinkData(
  invitation: LeagueInvitationDto,
): GenerateInviteLinkResponse {
  return { invitation };
}

export function getInvitationPreviewData(
  invitation: InvitationPreview,
): InvitationPreviewResponse {
  return { invitation };
}

export function acceptInvitationData(
  membership: AcceptedLeagueMembership,
): LeagueMembershipResponse {
  return { membership };
}
