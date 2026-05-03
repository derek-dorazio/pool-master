#!/usr/bin/env node
/**
 * Mint a GitHub App installation token from env-configured credentials.
 *
 * Reads:
 *   GH_APP_ID                  — numeric App ID
 *   GH_APP_INSTALLATION_ID     — numeric Installation ID
 *   GH_APP_PRIVATE_KEY_PATH    — path to the App's private key (.pem)
 *
 * Writes the installation token (40-char string) to stdout. Exit 0 on success;
 * non-zero with a diagnostic on stderr otherwise. Token is valid for ~1 hour.
 *
 * Usage in agent runtime:
 *
 *   export GH_APP_ID=...
 *   export GH_APP_INSTALLATION_ID=...
 *   export GH_APP_PRIVATE_KEY_PATH=...
 *   export GH_TOKEN=$(node scripts/get-app-installation-token.mjs)
 *
 *   gh api user --jq '.login'   # → <app-slug>[bot]
 *
 * Uses the gh CLI for the token-exchange call so it inherits macOS's system
 * trust store (avoids node bundled-CA quirks). The script depends only on
 * built-in node modules and the gh CLI, both of which are already required by
 * the rule-enforcement gates.
 *
 * See rules/workflow-rules.md §11 for the full multi-pass review identity model.
 */

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const APP_ID = process.env.GH_APP_ID;
const INSTALLATION_ID = process.env.GH_APP_INSTALLATION_ID;
const KEY_PATH = process.env.GH_APP_PRIVATE_KEY_PATH;

if (!APP_ID || !INSTALLATION_ID || !KEY_PATH) {
  fail(
    [
      'Missing required environment variables. Set:',
      '  GH_APP_ID                — numeric App ID',
      '  GH_APP_INSTALLATION_ID   — numeric Installation ID',
      '  GH_APP_PRIVATE_KEY_PATH  — path to the App private-key .pem',
      '',
      'See rules/workflow-rules.md §11 (Identity model — GitHub Apps per runtime)',
      'and docs/CI-AND-QUALITY-GATES.md for the App setup runbook.',
    ].join('\n'),
  );
}

let privateKey;
try {
  privateKey = readFileSync(KEY_PATH, 'utf8');
} catch (err) {
  fail(`Unable to read private key at ${KEY_PATH}: ${err.message}`);
}

// Build the App JWT (proves "I am this App" to GitHub for token exchange).
// GitHub requires iat ≤ now, exp ≤ now + 600s.
const header = Buffer.from(
  JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const payload = Buffer.from(
  JSON.stringify({ iat: now - 60, exp: now + 540, iss: APP_ID }),
).toString('base64url');
const signingInput = `${header}.${payload}`;

let signature;
try {
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signature = signer.sign(privateKey).toString('base64url');
} catch (err) {
  fail(`Unable to sign App JWT: ${err.message}`);
}

const appJwt = `${signingInput}.${signature}`;

// Exchange App JWT → installation token via gh CLI.
const result = spawnSync(
  'gh',
  [
    'api',
    '-H',
    `Authorization: Bearer ${appJwt}`,
    '-X',
    'POST',
    `/app/installations/${INSTALLATION_ID}/access_tokens`,
  ],
  { encoding: 'utf8' },
);

if (result.status !== 0) {
  fail(
    `gh api token exchange failed (exit ${result.status ?? 'unknown'}):\n` +
      (result.stderr || '(no stderr)'),
  );
}

let response;
try {
  response = JSON.parse(result.stdout);
} catch (err) {
  fail(`Unable to parse gh api response as JSON: ${err.message}\nRaw: ${result.stdout}`);
}

if (!response || typeof response.token !== 'string') {
  fail(
    `Token missing from response. Got: ${JSON.stringify(response).slice(0, 500)}`,
  );
}

process.stdout.write(response.token);
