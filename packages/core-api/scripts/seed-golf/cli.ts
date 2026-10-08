/**
 * Runs the 2026 golf seed (seed-golf.ts) against a running PoolMaster as a root admin.
 *
 * Usage:
 *   POOLMASTER_SEED_BASE_URL=http://localhost:3000 \
 *   POOLMASTER_SEED_ADMIN_IDENTIFIER=poolmaster-admin \
 *   POOLMASTER_SEED_ADMIN_PASSWORD=... \
 *   npm run seed:golf
 *
 * The base URL is the site root that serves /api/v1 (the API itself locally, the site on QA).
 * QA runs this through the "Seed QA golf data" workflow, never on deploy.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, createConfig, type Client } from '@poolmaster/shared/generated/hey-api/client';
import { loginUser } from '@poolmaster/shared/generated/hey-api';
import { seedGolf, type GolfSeedFile } from './seed-golf';

// Access tokens last 15 minutes; sign in again well before that.
const SIGN_IN_AGAIN_AFTER_MS = 10 * 60 * 1000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('POOLMASTER_SEED_BASE_URL').replace(/\/$/, '');
  const identifier = requireEnv('POOLMASTER_SEED_ADMIN_IDENTIFIER');
  const password = requireEnv('POOLMASTER_SEED_ADMIN_PASSWORD');
  const seed = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'golf-2026.json'), 'utf8')) as GolfSeedFile;

  let signedIn: { client: Client; at: number } | null = null;
  const getClient = async (): Promise<Client> => {
    if (signedIn && Date.now() - signedIn.at < SIGN_IN_AGAIN_AFTER_MS) return signedIn.client;
    const login = await loginUser({ client: createClient(createConfig({ baseUrl })), body: { identifier, password } });
    if (!login.data) {
      throw new Error(`Sign-in as ${identifier} failed (HTTP ${login.response?.status ?? 'none'}).`);
    }
    if (!login.data.user.isRootAdmin) throw new Error(`${identifier} is not a root admin.`);
    const { accessToken } = login.data.tokens;
    const client = createClient(createConfig({ baseUrl }));
    client.interceptors.request.use((request: Request) => {
      request.headers.set('Authorization', `Bearer ${accessToken}`);
      return request;
    });
    signedIn = { client, at: Date.now() };
    return client;
  };

  const summaries = await seedGolf(seed, { getClient, now: new Date(), log: (line) => console.log(line) });
  for (const summary of summaries) {
    const drafts = summary.skipped.filter((skipped) => skipped.status === 'DRAFT');
    console.log(`${summary.tour}: ${summary.created.length} created, ${summary.skipped.length} already there.`);
    for (const draft of drafts) {
      console.log(`  ${draft.name} exists as a draft. If an earlier seed run stopped on it, delete it and run the seed again.`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
