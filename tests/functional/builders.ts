import { createLeague, loginUser, registerUser } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { createAuthenticatedClient, createFunctionalEmail, getSdkClient } from './setup';

function describeSdkFailure(result: {
  response?: Response | undefined;
  error?: unknown;
}): string {
  const status = result.response?.status;
  const payload = result.error;
  const details = payload ? JSON.stringify(payload) : 'no error payload';
  return `status=${status ?? 'unknown'} payload=${details}`;
}

export interface RegisteredUserContext {
  client: Client;
  displayName: string;
  email: string;
  login: {
    tokens: {
      accessToken: string;
      refreshToken: string;
      csrfToken: string;
      expiresIn: number;
    };
    user: {
      id: string;
      email: string;
      displayName: string;
    };
  };
  password: string;
  registration: {
    tokens: {
      accessToken: string;
      refreshToken: string;
      csrfToken: string;
      expiresIn: number;
    };
    user: {
      id: string;
      email: string;
      displayName: string;
    };
  };
  token: string;
  userId: string;
}

export async function buildRegisteredUser(overrides?: {
  displayName?: string;
  email?: string;
  password?: string;
}): Promise<RegisteredUserContext> {
  const email = overrides?.email ?? createFunctionalEmail('auth');
  const password = overrides?.password ?? 'FuncTest123!';
  const displayName = overrides?.displayName ?? 'Functional Pilot User';

  const registration = await registerUser({
    client: getSdkClient(),
    body: {
      email,
      password,
      displayName,
    },
  });

  if (!registration.data) {
    throw new Error(`Builder: registerUser failed for ${email} (${describeSdkFailure(registration)})`);
  }

  const login = await loginUser({
    client: getSdkClient(),
    body: {
      email,
      password,
    },
  });

  if (!login.data) {
    throw new Error(`Builder: loginUser failed for ${email} (${describeSdkFailure(login)})`);
  }

  const token = login.data.tokens.accessToken;
  const client = createAuthenticatedClient(token);

  return {
    client,
    displayName,
    email,
    login: login.data,
    password,
    registration: registration.data,
    token,
    userId: registration.data.user.id,
  };
}

export async function buildLeagueWithCommissioner(overrides?: {
  displayName?: string;
  email?: string;
  leagueName?: string;
  password?: string;
}): Promise<{
  league: {
    id: string;
    name: string;
    memberCount: number;
    activeContestCount: number;
    visibility: string;
    createdAt?: string;
    description?: string;
    invitePolicy?: string;
    maxMembers?: number;
    role?: string;
    settings?: Record<string, unknown>;
  };
  commissioner: RegisteredUserContext;
  commissionerClient: Client;
}> {
  const commissioner = await buildRegisteredUser({
    displayName: overrides?.displayName,
    email: overrides?.email,
    password: overrides?.password,
  });

  const leagueResponse = await createLeague({
    client: commissioner.client,
    body: {
      name: overrides?.leagueName ?? 'Functional Pilot League',
      visibility: 'PRIVATE',
      settings: {
        invitePolicy: 'COMMISSIONER_ONLY',
      },
    },
  });

  if (!leagueResponse.data) {
    throw new Error(
      `Builder: createLeague failed for commissioner ${commissioner.userId} `
      + `(${describeSdkFailure(leagueResponse)})`,
    );
  }

  return {
    league: leagueResponse.data.league,
    commissioner,
    commissionerClient: commissioner.client,
  };
}
