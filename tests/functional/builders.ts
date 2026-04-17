import { createLeague, loginUser, registerUser } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { randomUUID } from 'node:crypto';
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
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  username: string;
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
      username: string;
      firstName: string;
      lastName: string;
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
      username: string;
      firstName: string;
      lastName: string;
    };
  };
  token: string;
  userId: string;
}

export async function buildRegisteredUser(overrides?: {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  username?: string;
  password?: string;
}): Promise<RegisteredUserContext> {
  const email = overrides?.email ?? createFunctionalEmail('auth');
  const username = overrides?.username ?? email;
  const password = overrides?.password ?? 'FuncTest123!';
  const fallbackName = overrides?.displayName ?? 'Functional Pilot User';
  const [fallbackFirstName, ...fallbackLastParts] = fallbackName.split(/\s+/);
  const firstName = overrides?.firstName ?? fallbackFirstName ?? 'Functional';
  const lastName = overrides?.lastName ?? (fallbackLastParts.join(' ').trim() || 'User');
  const displayName = `${firstName} ${lastName}`;

  const registration = await registerUser({
    client: getSdkClient(),
    body: {
      username,
      email,
      password,
      firstName,
      lastName,
    },
  });

  if (!registration.data) {
    throw new Error(`Builder: registerUser failed for ${email} (${describeSdkFailure(registration)})`);
  }

  const login = await loginUser({
    client: getSdkClient(),
    body: {
      identifier: username,
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
    firstName,
    lastName,
    displayName,
    email,
    username,
    login: login.data,
    password,
    registration: registration.data,
    token,
    userId: registration.data.user.id,
  };
}

export async function buildLeagueWithCommissioner(overrides?: {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  username?: string;
  leagueName?: string;
  password?: string;
}): Promise<{
  league: {
    id: string;
    name: string;
    memberCount: number;
    activeContestCount: number;
    isActive: boolean;
    joinPolicy: string;
    createdAt?: string;
    description?: string;
    role?: string;
  };
  commissioner: RegisteredUserContext;
  commissionerClient: Client;
}> {
  const commissioner = await buildRegisteredUser({
    firstName: overrides?.firstName,
    lastName: overrides?.lastName,
    displayName: overrides?.displayName,
    email: overrides?.email,
    username: overrides?.username,
    password: overrides?.password,
  });

  const leagueResponse = await createLeague({
    client: commissioner.client,
    body: {
      name: overrides?.leagueName ?? 'Functional Pilot League',
      leagueCode: `FUNC${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
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
