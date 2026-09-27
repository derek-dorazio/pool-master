import { LeagueIconKey, LeagueRole, TeamIconKey } from '@poolmaster/shared/domain';
import type { UserProfileDto, DeleteLeagueResponses, GenerateInviteLinkResponse, InvitationPreviewResponse, LeagueDetailDto, LeagueInvitationDto, LeagueListResponse, LeagueMembershipDto, LeagueMembershipResponse, LeagueResponse, LeagueSummaryDto, SquadDto, SquadListResponse, SquadResponse } from '@/lib/api';

export type CurrentUser = UserProfileDto;
export type LeagueSquadMember = NonNullable<SquadDto['members']>[number];
export type InvitationPreview = InvitationPreviewResponse['invitation'];
export type AcceptedLeagueMembership = LeagueMembershipDto;
export type GeneratedInviteLink = LeagueInvitationDto;

type LeagueSummaryFixture = Pick<
  LeagueSummaryDto,
  | 'id'
  | 'leagueCode'
  | 'name'
  | 'description'
  | 'isActive'
  | 'iconKey'
  | 'memberCount'
  | 'activeContestCount'
  | 'memberType'
  | 'leagueRelationship'
  | 'isRootAdmin'
  | 'createdAt'
>;

type LeagueDetailFixture = LeagueSummaryFixture & Pick<LeagueDetailDto, 'joinPolicy'>;

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
  | 'teamRelationship'
  | 'isRootAdmin'
  | 'members'
>;

type LeagueSquadMemberFixture = Pick<
  LeagueSquadMember,
  | 'id'
  | 'squadId'
  | 'leagueId'
  | 'userId'
  | 'firstName'
  | 'lastName'
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

const baseLeagueSummary: LeagueSummaryFixture = {
  id: 'league-1',
  leagueCode: 'BIGDAWGS',
  name: 'Big Dawgs',
  description: 'A test league',
  isActive: true,
  iconKey: LeagueIconKey.TROPHY,
  memberCount: 2,
  activeContestCount: 1,
  memberType: LeagueRole.COMMISSIONER,
  leagueRelationship: {
    leagueMember: true,
    commissioner: true,
  },
  isRootAdmin: false,
  createdAt: '2026-04-15T00:00:00.000Z',
};

const baseLeagueDetail: LeagueDetailFixture = {
  ...baseLeagueSummary,
  joinPolicy: 'COMMISSIONER_ONLY',
};

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

const baseSquadMember: LeagueSquadMemberFixture = {
  id: 'team-membership-1',
  squadId: 'team-1',
  leagueId: 'league-1',
  userId: 'user-1',
  firstName: 'Casey',
  lastName: 'Commissioner',
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
  teamRelationship: {
    leagueMember: true,
    owner: true,
    commissioner: true,
  },
  isRootAdmin: false,
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

export function buildLeagueSummary(overrides: Partial<LeagueSummaryDto> = {}): LeagueSummaryDto {
  return {
    ...baseLeagueSummary,
    ...overrides,
  };
}

export function buildLeagueDetail(overrides: Partial<LeagueDetailDto> = {}): LeagueDetailDto {
  return {
    ...baseLeagueDetail,
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

export function listLeaguesData(leagues: LeagueSummaryDto[]): LeagueListResponse {
  return { leagues };
}

export function getLeagueData(league: LeagueDetailDto): LeagueResponse {
  return { league };
}

export function getLeagueByCodeData(
  league: LeagueDetailDto,
): LeagueResponse {
  return { league };
}

export function createLeagueData(
  league: LeagueDetailDto,
): LeagueResponse {
  return { league };
}

export function updateLeagueDetailsData(
  league: LeagueDetailDto,
): LeagueResponse {
  return { league };
}

export function updateLeagueIconData(
  league: LeagueDetailDto,
): LeagueResponse {
  return { league };
}

export function inactivateLeagueData(
  league: LeagueDetailDto,
): LeagueResponse {
  return { league };
}

export function activateLeagueData(
  league: LeagueDetailDto,
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
