import { http, HttpResponse, type HttpHandler } from 'msw';
import { setupServer } from 'msw/node';
import { beforeEach, vi, type Mock } from 'vitest';

type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

interface OperationDefinition {
  method: HttpMethod;
  path: string;
}

interface ApiMockResult {
  data?: unknown;
  error?: unknown;
  response?: {
    status?: number;
  };
  status?: number;
}

type ApiMock = Mock<(options: Record<string, unknown>) => Promise<ApiMockResult> | ApiMockResult>;

const operationDefinitions = {
  acceptInvitation: { method: 'post', path: '/api/v1/invitations/accept' },
  acceptTeamOwnerInvitation: { method: 'post', path: '/api/v1/team-invitations/accept' },
  activateLeague: { method: 'post', path: '/api/v1/leagues/{id}/activate' },
  adminDeleteUser: { method: 'delete', path: '/api/v1/admin/users/{userId}' },
  adminDisableUser: { method: 'post', path: '/api/v1/admin/users/{userId}/disable' },
  adminEnableUser: { method: 'post', path: '/api/v1/admin/users/{userId}/enable' },
  adminGetIngestionDashboard: { method: 'get', path: '/api/v1/admin/providers/ingestion' },
  adminGetIngestionSchedule: { method: 'get', path: '/api/v1/admin/config/ingestion-schedule' },
  adminGetPollIntervals: { method: 'get', path: '/api/v1/admin/config/poll-intervals' },
  adminGetUserDetail: { method: 'get', path: '/api/v1/admin/users/{userId}' },
  adminListContestConfigTemplates: { method: 'get', path: '/api/v1/admin/contest-config-templates' },
  adminListLeagues: { method: 'get', path: '/api/v1/admin/leagues' },
  adminListProviderSyncRuns: { method: 'get', path: '/api/v1/admin/providers/sync-runs' },
  adminListProviders: { method: 'get', path: '/api/v1/admin/providers/health' },
  adminListTeams: { method: 'get', path: '/api/v1/admin/teams' },
  adminListUsers: { method: 'get', path: '/api/v1/admin/users' },
  adminPrepareSportSync: { method: 'post', path: '/api/v1/admin/providers/sync/{sport}' },
  adminResetIngestionSchedule: { method: 'post', path: '/api/v1/admin/config/ingestion-schedule/reset' },
  adminResetPollIntervals: { method: 'post', path: '/api/v1/admin/config/poll-intervals/reset' },
  adminResetSportIngestionOverride: { method: 'post', path: '/api/v1/admin/config/ingestion-schedule/{sport}/reset' },
  adminResetUserPassword: { method: 'post', path: '/api/v1/admin/users/{userId}/reset-password' },
  adminSetSportIngestionOverride: { method: 'put', path: '/api/v1/admin/config/ingestion-schedule/{sport}' },
  adminSetUserRootAdmin: { method: 'post', path: '/api/v1/admin/users/{userId}/root-admin' },
  adminSyncProviderEventData: { method: 'post', path: '/api/v1/admin/providers/events/{sport}/{eventId}/sync' },
  adminUpdateContestConfigTemplate: { method: 'put', path: '/api/v1/admin/contest-config-templates/{templateId}' },
  adminUpdateIngestionSchedule: { method: 'put', path: '/api/v1/admin/config/ingestion-schedule' },
  adminUpdatePollIntervals: { method: 'put', path: '/api/v1/admin/config/poll-intervals' },
  changeAccountPassword: { method: 'post', path: '/api/v1/account/password' },
  changeMemberRole: { method: 'put', path: '/api/v1/leagues/{id}/members/{uid}/role' },
  createLeague: { method: 'post', path: '/api/v1/leagues/' },
  createLeagueSquad: { method: 'post', path: '/api/v1/leagues/{id}/squads/' },
  createManagedContest: { method: 'post', path: '/api/v1/leagues/{id}/contest-management/contests' },
  createSquadOwnerInvitation: { method: 'post', path: '/api/v1/leagues/{id}/squads/{squadId}/owner-invitations' },
  deleteAccount: { method: 'delete', path: '/api/v1/account/' },
  deleteContest: { method: 'delete', path: '/api/v1/contests/{contestId}' },
  deleteLeague: { method: 'delete', path: '/api/v1/leagues/{id}' },
  deleteLeagueSquad: { method: 'delete', path: '/api/v1/leagues/{id}/squads/{squadId}' },
  enterContest: { method: 'post', path: '/api/v1/contests/{contestId}/entries/me' },
  generateInviteLink: { method: 'post', path: '/api/v1/leagues/{id}/invite-link' },
  getContest: { method: 'get', path: '/api/v1/contests/{contestId}' },
  getCurrentUser: { method: 'get', path: '/api/v1/auth/me' },
  getDraftState: { method: 'get', path: '/api/v1/drafts/{contestId}' },
  getInvitationPreview: { method: 'get', path: '/api/v1/invitations/{inviteCode}' },
  getLeague: { method: 'get', path: '/api/v1/leagues/{id}' },
  getLeagueByCode: { method: 'get', path: '/api/v1/leagues/code/{leagueCode}' },
  getManagedContest: { method: 'get', path: '/api/v1/leagues/{id}/contest-management/contests/{contestId}' },
  getMyContestEntry: { method: 'get', path: '/api/v1/contests/{contestId}/entries/me' },
  getTeamOwnerInvitationPreview: { method: 'get', path: '/api/v1/team-invitations/{inviteCode}' },
  inactivateAccount: { method: 'post', path: '/api/v1/account/inactivate' },
  inactivateLeague: { method: 'post', path: '/api/v1/leagues/{id}/inactivate' },
  inactivateLeagueSquad: { method: 'post', path: '/api/v1/leagues/{id}/squads/{squadId}/inactivate' },
  leaveLeague: { method: 'delete', path: '/api/v1/leagues/{id}/members/me' },
  listContestEntries: { method: 'get', path: '/api/v1/contests/{contestId}/entries' },
  listContests: { method: 'get', path: '/api/v1/leagues/{id}/contests/' },
  listEvents: { method: 'get', path: '/api/v1/events/' },
  listLeagueMembers: { method: 'get', path: '/api/v1/leagues/{id}/members' },
  listLeagueSquads: { method: 'get', path: '/api/v1/leagues/{id}/squads/' },
  listLeagues: { method: 'get', path: '/api/v1/leagues/' },
  listManagedContestTemplates: { method: 'get', path: '/api/v1/leagues/{id}/contest-management/templates' },
  listSquadOwnerInvitations: { method: 'get', path: '/api/v1/leagues/{id}/squads/owner-invitations' },
  loginUser: { method: 'post', path: '/api/v1/auth/login' },
  logoutUser: { method: 'post', path: '/api/v1/auth/logout' },
  reactivateAccount: { method: 'post', path: '/api/v1/account/reactivate' },
  refreshToken: { method: 'post', path: '/api/v1/auth/refresh' },
  registerUser: { method: 'post', path: '/api/v1/auth/register' },
  removeSquadOwner: { method: 'delete', path: '/api/v1/leagues/{id}/squads/{squadId}/members/{userId}' },
  replaceSquadOwner: { method: 'post', path: '/api/v1/leagues/{id}/squads/{squadId}/owners/{userId}/replace' },
  revokeSquadOwnerInvitation: { method: 'delete', path: '/api/v1/leagues/{id}/squads/owner-invitations/{invitationId}' },
  sendLeagueInvitations: { method: 'post', path: '/api/v1/leagues/{id}/invitations' },
  submitContestSelection: { method: 'post', path: '/api/v1/drafts/{contestId}/pick' },
  updateAccountPreferences: { method: 'put', path: '/api/v1/account/preferences' },
  updateAccountProfile: { method: 'put', path: '/api/v1/account/profile' },
  updateAccountUsername: { method: 'put', path: '/api/v1/account/username' },
  updateContest: { method: 'put', path: '/api/v1/contests/{contestId}' },
  updateContestEntry: { method: 'patch', path: '/api/v1/contests/{contestId}/entries/{entryId}' },
  updateLeagueDetails: { method: 'put', path: '/api/v1/leagues/{id}/details' },
  updateLeagueIcon: { method: 'put', path: '/api/v1/leagues/{id}/icon' },
  updateLeagueSquad: { method: 'patch', path: '/api/v1/leagues/{id}/squads/{squadId}' },
  updateManagedContestConfiguration: { method: 'put', path: '/api/v1/leagues/{id}/contest-management/contests/{contestId}/configuration' },
} as const satisfies Record<string, OperationDefinition>;

type ApiOperationName = keyof typeof operationDefinitions;

function createApiMocks() {
  return Object.fromEntries(
    Object.keys(operationDefinitions).map((operationName) => [
      operationName,
      vi.fn(),
    ]),
  ) as Record<ApiOperationName, ApiMock>;
}

export const mockApi = createApiMocks();

function toMswPath(path: string) {
  return `*${path.replaceAll(/\{([^}]+)\}/g, ':$1')}`;
}

function queryParamsFor(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const query: Record<string, number | string | Array<number | string>> = {};

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key).map((value) =>
      /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value);
    query[key] = values.length === 1 ? values[0] ?? '' : values;
  }

  return query;
}

async function requestBodyFor(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  const text = await request.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeParams(params: Record<string, readonly string[] | string | undefined>) {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([key, value]) => !/^\d+$/.test(key) && value !== undefined)
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ]),
  );
}

function statusFor(result: ApiMockResult) {
  if (typeof result.status === 'number') {
    return result.status;
  }
  if (typeof result.response?.status === 'number') {
    return result.response.status;
  }
  if (result.error) {
    const code = typeof result.error === 'object'
      && result.error
      && 'code' in result.error
      && typeof result.error.code === 'string'
      ? result.error.code
      : null;

    return code?.startsWith('AUTH_') || code?.startsWith('ROOT_ADMIN_') ? 401 : 400;
  }
  return 200;
}

function responseFor(result: ApiMockResult | undefined, operationName: ApiOperationName) {
  if (!result) {
    throw new Error(`Unhandled PoolMaster API request in test: ${operationName}`);
  }

  if (result.error) {
    return HttpResponse.json(result.error, { status: statusFor(result) });
  }

  return HttpResponse.json(result.data ?? null, { status: statusFor(result) });
}

function createHandler(operationName: ApiOperationName, definition: OperationDefinition): HttpHandler {
  return http[definition.method](toMswPath(definition.path), async ({ params, request }) => {
    const path = normalizeParams(params);
    const query = queryParamsFor(request);
    const body = await requestBodyFor(request);
    const options = {
      ...(Object.keys(path).length > 0 ? { path } : {}),
      ...(Object.keys(query).length > 0 ? { query } : {}),
      ...(body !== undefined ? { body } : {}),
    };
    const result = await Promise.resolve(mockApi[operationName](options)).catch((error: unknown) => {
      if (operationName === 'logoutUser') {
        return undefined;
      }

      return {
        error: {
          message: error instanceof Error ? error.message : 'Request failed',
        },
        response: { status: 400 },
      };
    });

    if (!result) {
      return HttpResponse.error();
    }

    return responseFor(result, operationName);
  });
}

export const poolmasterApiHandlers = Object.entries(operationDefinitions).map(
  ([operationName, definition]) =>
    createHandler(operationName as ApiOperationName, definition),
);

export const server = setupServer(...poolmasterApiHandlers);

export function resetApiMocks() {
  for (const apiMock of Object.values(mockApi)) {
    apiMock.mockReset();
  }
}

export function bindApiMocks(bindings: Partial<Record<ApiOperationName, ApiMock>>) {
  beforeEach(() => {
    for (const [operationName, apiMock] of Object.entries(bindings)) {
      mockApi[operationName as ApiOperationName].mockImplementation((options) =>
        apiMock(options));
    }
  });
}
