import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createClient, createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';

export interface FunctionalServerState {
  pid: number;
  port: number;
  baseUrl: string;
  runId: string;
}

export interface FunctionalErrorExpectation {
  status: number;
  code: string;
}

const stateFilePath = path.join(process.cwd(), 'coverage', 'functional', 'server-state.json');

let prisma: PrismaClient | undefined;

function readState(): FunctionalServerState {
  if (!fs.existsSync(stateFilePath)) {
    throw new Error(
      `Functional server state file not found at ${stateFilePath}. ` +
        'Did the functional global setup run?',
    );
  }

  const raw = fs.readFileSync(stateFilePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<FunctionalServerState>;

  if (
    typeof parsed.pid !== 'number' ||
    typeof parsed.port !== 'number' ||
    typeof parsed.baseUrl !== 'string' ||
    typeof parsed.runId !== 'string'
  ) {
    throw new Error(`Invalid functional server state: ${raw}`);
  }

  return parsed as FunctionalServerState;
}

export function getFunctionalServerState(): FunctionalServerState {
  return readState();
}

export function getFunctionalRunId(): string {
  return readState().runId;
}

export function getFunctionalBaseUrl(): string {
  return readState().baseUrl;
}

export function getSdkClient(): Client {
  return createClient(
    createConfig({
      baseUrl: getFunctionalBaseUrl(),
    }),
  );
}

export function createAuthenticatedClient(accessToken: string): Client {
  const client = createClient(
    createConfig({
      baseUrl: getFunctionalBaseUrl(),
    }),
  );

  client.interceptors.request.use((request: Request) => {
    request.headers.set('Authorization', `Bearer ${accessToken}`);
    return request;
  });

  return client;
}

export function getFunctionalPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export async function disconnectFunctionalPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}

export async function cleanupFunctionalData(): Promise<void> {
  const database = getFunctionalPrisma();
  const runId = getFunctionalRunId();
  const emailPrefix = `functional-${runId}-`;

  const users = await database.user.findMany({
    where: {
      email: {
        startsWith: emailPrefix,
      },
    },
    select: {
      id: true,
      tenantId: true,
    },
  });

  if (users.length === 0) {
    return;
  }

  const userIds = users.map((user) => user.id);
  const tenantIds = Array.from(new Set(users.map((user) => user.tenantId).filter(Boolean)));

  await database.consentRecord.deleteMany({
    where: {
      userId: {
        in: userIds,
      },
    },
  });
  await database.refreshToken.deleteMany({
    where: {
      userId: {
        in: userIds,
      },
    },
  });
  await database.user.deleteMany({
    where: {
      id: {
        in: userIds,
      },
    },
  });
  if (tenantIds.length > 0) {
    await database.tenant.deleteMany({
      where: {
        id: {
          in: tenantIds,
        },
      },
    });
  }
}

export function expectFunctionalError(
  result: { error?: unknown; response?: Response | undefined; data?: unknown },
  expected: FunctionalErrorExpectation,
): void {
  expect(result.data).toBeUndefined();
  expect(result.response?.status).toBe(expected.status);

  const payload = result.error as Record<string, unknown> | undefined;
  const actualCode =
    typeof payload?.error === 'string'
      ? payload.error
      : typeof payload?.code === 'string'
        ? payload.code
        : undefined;

  expect(actualCode).toBe(expected.code);
}

export function createFunctionalEmail(prefix = 'pilot'): string {
  const runId = getFunctionalRunId();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `functional-${runId}-${prefix}-${stamp}@functional.test`;
}
