import { expect, type APIResponse, type Page } from '@playwright/test';
import { qaLeagueSeed } from './qa-users';

type LeagueDetail = {
  id: string;
  leagueCode: string;
  name: string;
  isActive?: boolean;
  leagueRelationship?: {
    leagueMember?: boolean;
    commissioner?: boolean;
  };
};

export type QALeagueFixture = {
  code: string;
  id: string;
  name: string;
};

async function parseJson(response: APIResponse): Promise<unknown> {
  return response.json().catch(() => null);
}

async function errorMessage(response: APIResponse) {
  const body = await parseJson(response);
  if (body && typeof body === 'object') {
    const envelope = body as { error?: { code?: unknown; message?: unknown }; message?: unknown };
    const code = typeof envelope.error?.code === 'string' ? envelope.error.code : null;
    const message = typeof envelope.error?.message === 'string'
      ? envelope.error.message
      : typeof envelope.message === 'string'
        ? envelope.message
        : null;
    return [code, message].filter(Boolean).join(': ');
  }

  return `${response.status()} ${response.statusText()}`;
}

async function csrfHeaders(page: Page) {
  const cookies = await page.context().cookies();
  const csrfToken = cookies.find((cookie) => cookie.name === 'poolmaster_csrf')?.value;
  return csrfToken ? { 'X-CSRF-Token': csrfToken } : {};
}

async function getLeagueByCode(page: Page): Promise<LeagueDetail | null> {
  const response = await page.request.get(`/api/v1/leagues/code/${qaLeagueSeed.code}`);

  if (response.status() === 404 || response.status() === 403) {
    return null;
  }

  if (!response.ok()) {
    throw new Error(`QA league lookup failed: ${await errorMessage(response)}`);
  }

  const body = await parseJson(response) as { league?: LeagueDetail } | null;
  if (!body?.league) {
    throw new Error('QA league lookup returned no league payload.');
  }

  return body.league;
}

async function createQALeague(page: Page): Promise<LeagueDetail> {
  const response = await page.request.post('/api/v1/leagues/', {
    data: {
      name: qaLeagueSeed.name,
      leagueCode: qaLeagueSeed.code,
      description: qaLeagueSeed.description,
    },
    headers: await csrfHeaders(page),
  });

  if (response.status() === 409) {
    const existing = await getLeagueByCode(page);
    if (existing) {
      return existing;
    }
  }

  if (!response.ok()) {
    throw new Error(`QA league creation failed: ${await errorMessage(response)}`);
  }

  const body = await parseJson(response) as { league?: LeagueDetail } | null;
  if (!body?.league) {
    throw new Error('QA league creation returned no league payload.');
  }

  return body.league;
}

async function activateQALeague(page: Page, league: LeagueDetail): Promise<LeagueDetail> {
  if (league.isActive !== false) {
    return league;
  }

  const response = await page.request.post(`/api/v1/leagues/${league.id}/activate`, {
    headers: await csrfHeaders(page),
  });

  if (!response.ok()) {
    throw new Error(`QA league activation failed: ${await errorMessage(response)}`);
  }

  const refreshed = await getLeagueByCode(page);
  if (!refreshed) {
    throw new Error('QA league was activated but could not be reloaded.');
  }
  return refreshed;
}

async function generateMemberInvite(page: Page, league: LeagueDetail): Promise<string> {
  const response = await page.request.post(`/api/v1/leagues/${league.id}/invite-link`, {
    data: { maxUses: 0 },
    headers: await csrfHeaders(page),
  });

  if (!response.ok()) {
    throw new Error(`QA league invite creation failed: ${await errorMessage(response)}`);
  }

  const body = await parseJson(response) as { invitation?: { inviteCode?: string } } | null;
  if (!body?.invitation?.inviteCode) {
    throw new Error('QA league invite creation returned no invite code.');
  }

  return body.invitation.inviteCode;
}

async function acceptInvite(page: Page, inviteCode: string) {
  const response = await page.request.post('/api/v1/invitations/accept', {
    data: { inviteCode },
    headers: await csrfHeaders(page),
  });

  if (!response.ok()) {
    throw new Error(`QA member invite acceptance failed: ${await errorMessage(response)}`);
  }
}

export async function ensureQALeague(
  commissionerPage: Page,
  memberPage: Page,
): Promise<QALeagueFixture> {
  let league = await getLeagueByCode(commissionerPage);
  if (!league) {
    league = await createQALeague(commissionerPage);
  }

  if (!league.leagueRelationship?.commissioner) {
    throw new Error(`QA commissioner is not a commissioner of ${qaLeagueSeed.code}.`);
  }

  league = await activateQALeague(commissionerPage, league);

  const memberLeague = await getLeagueByCode(memberPage);
  if (!memberLeague?.leagueRelationship?.leagueMember) {
    const inviteCode = await generateMemberInvite(commissionerPage, league);
    await acceptInvite(memberPage, inviteCode);
  }

  const repairedMemberLeague = await getLeagueByCode(memberPage);
  if (!repairedMemberLeague?.leagueRelationship?.leagueMember) {
    throw new Error(`QA member does not have active access to ${qaLeagueSeed.code}.`);
  }

  await commissionerPage.goto(`/league/${qaLeagueSeed.code}`);
  await expect(commissionerPage.getByTestId('league-home')).toBeVisible();
  await memberPage.goto(`/league/${qaLeagueSeed.code}`);
  await expect(memberPage.getByTestId('league-home')).toBeVisible();

  return {
    code: league.leagueCode,
    id: league.id,
    name: league.name,
  };
}
