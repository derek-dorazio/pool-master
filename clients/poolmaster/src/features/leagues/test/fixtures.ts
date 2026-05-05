import { LeagueIconKey, LeagueRole, TeamIconKey } from '@poolmaster/shared/domain';
import type {
  AcceptInvitationResponses,
  ActivateLeagueResponses,
  CreateLeagueResponses,
  DeleteLeagueResponses,
  GenerateInviteLinkResponses,
  GetCurrentUserResponses,
  GetInvitationPreviewResponses,
  GetLeagueByCodeResponses,
  GetLeagueResponses,
  InactivateLeagueResponses,
  ListLeagueSquadsResponses,
  ListLeaguesResponses,
  UpdateLeagueDetailsResponses,
  UpdateLeagueIconResponses,
  UpdateLeagueSquadResponses,
} from '@/lib/api';

export type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];
export type LeagueDetail = GetLeagueResponses[200]['league'];
export type CurrentUser = GetCurrentUserResponses[200]['user'];
export type LeagueSquad = ListLeagueSquadsResponses[200]['squads'][number];
export type LeagueSquadMember = NonNullable<LeagueSquad['members']>[number];
export type InvitationPreview = GetInvitationPreviewResponses[200]['invitation'];
export type AcceptedLeagueMembership = AcceptInvitationResponses[201]['membership'];
export type GeneratedInviteLink = GenerateInviteLinkResponses[201]['invitation'];

type LeagueSummaryFixture = Pick<
  LeagueSummary,
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

type LeagueDetailFixture = LeagueSummaryFixture & Pick<LeagueDetail, 'joinPolicy'>;

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
  | 'sessionId'
>;

type LeagueSquadFixture = Pick<
  LeagueSquad,
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
  sessionId: 'session-1',
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

export function buildLeagueSummary(overrides: Partial<LeagueSummary> = {}): LeagueSummary {
  return {
    ...baseLeagueSummary,
    ...overrides,
  };
}

export function buildLeagueDetail(overrides: Partial<LeagueDetail> = {}): LeagueDetail {
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

export function buildLeagueSquad(overrides: Partial<LeagueSquad> = {}): LeagueSquad {
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

export function listLeaguesData(leagues: LeagueSummary[]): ListLeaguesResponses[200] {
  return { leagues };
}

export function getLeagueData(league: LeagueDetail): GetLeagueResponses[200] {
  return { league };
}

export function getLeagueByCodeData(
  league: GetLeagueByCodeResponses[200]['league'],
): GetLeagueByCodeResponses[200] {
  return { league };
}

export function createLeagueData(
  league: CreateLeagueResponses[201]['league'],
): CreateLeagueResponses[201] {
  return { league };
}

export function updateLeagueDetailsData(
  league: UpdateLeagueDetailsResponses[200]['league'],
): UpdateLeagueDetailsResponses[200] {
  return { league };
}

export function updateLeagueIconData(
  league: UpdateLeagueIconResponses[200]['league'],
): UpdateLeagueIconResponses[200] {
  return { league };
}

export function inactivateLeagueData(
  league: InactivateLeagueResponses[200]['league'],
): InactivateLeagueResponses[200] {
  return { league };
}

export function activateLeagueData(
  league: ActivateLeagueResponses[200]['league'],
): ActivateLeagueResponses[200] {
  return { league };
}

export function deleteLeagueData(): DeleteLeagueResponses[200] {
  return { success: true };
}

export function listLeagueSquadsData(
  squads: LeagueSquad[],
): ListLeagueSquadsResponses[200] {
  return { squads };
}

export function updateLeagueSquadData(
  squad: UpdateLeagueSquadResponses[200]['squad'],
): UpdateLeagueSquadResponses[200] {
  return { squad };
}

export function generateInviteLinkData(
  invitation: GenerateInviteLinkResponses[201]['invitation'],
): GenerateInviteLinkResponses[201] {
  return { invitation };
}

export function getInvitationPreviewData(
  invitation: InvitationPreview,
): GetInvitationPreviewResponses[200] {
  return { invitation };
}

export function acceptInvitationData(
  membership: AcceptedLeagueMembership,
): AcceptInvitationResponses[201] {
  return { membership };
}
