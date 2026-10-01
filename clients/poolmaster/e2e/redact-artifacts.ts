import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { readAdminIdentifier } from './helpers/admin-session';

/**
 * #278 — keeps traces on while keeping credentials out of uploaded artifacts.
 *
 * A Playwright trace records every fill() value, every step title, and every request and
 * response body, so a failing run against QA would otherwise publish the admin's identifier
 * and password, its account email, and a live session token. This runs as the config's
 * globalTeardown: after the traces are written to the output directory and before the HTML
 * reporter copies them into its report, so both get the scrubbed copy. It runs locally and in
 * both CI jobs alike.
 *
 * Fails closed: a trace that cannot be rewritten is deleted rather than left unredacted.
 */

/** Every generated password starts with this so it is findable in a trace. */
export const GENERATED_PASSWORD_PREFIX = 'e2e-pw-';

const REDACTED = '[REDACTED]';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.webm', '.mp4',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

const SENSITIVE_JSON_KEYS = [
  'password', 'confirmPassword', 'temporaryPassword', 'identifier', 'username', 'email',
  'accessToken', 'refreshToken', 'csrfToken',
].join('|');

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildRules(): Array<[RegExp, string]> {
  const rules: Array<[RegExp, string]> = [];

  // The admin's real values, wherever they appear: fill() params, step titles, snapshots.
  const knownValues = [process.env.POOLMASTER_E2E_ADMIN_PASSWORD, readAdminIdentifier()]
    .filter((value): value is string => Boolean(value && value.length >= 4));
  for (const value of knownValues) {
    rules.push([new RegExp(escapeRegExp(value), 'g'), REDACTED]);
  }

  rules.push(
    // Any email address, including the deployed admin's own, returned by user reads.
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED],
    // Values the specs generate: `e2e-<role>-<runId>` usernames and prefixed passwords.
    [new RegExp(`${escapeRegExp(GENERATED_PASSWORD_PREFIX)}[0-9a-f]+`, 'g'), REDACTED],
    [/\be2e-[a-z]+-[a-z0-9]+\b/g, REDACTED],
    // Credential and token fields in request and response bodies, raw or JSON-escaped.
    [
      new RegExp(`(\\\\?"(?:${SENSITIVE_JSON_KEYS})\\\\?"\\s*:\\s*\\\\?")[^"\\\\]*`, 'g'),
      `$1${REDACTED}`,
    ],
    // Session cookies, the CSRF header, bearer tokens and any JWT.
    [/(poolmaster_(?:access|refresh|csrf)=)[^;\s"\\]+/g, `$1${REDACTED}`],
    [/("name"\s*:\s*"x-csrf-token"\s*,\s*"value"\s*:\s*")[^"]*/gi, `$1${REDACTED}`],
    [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, `$1${REDACTED}`],
    [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  );

  return rules;
}

function redactText(text: string, rules: Array<[RegExp, string]>): string {
  return rules.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}

function redactFile(filePath: string, rules: Array<[RegExp, string]>): void {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return;
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) {
    return;
  }
  const original = buffer.toString('utf8');
  const redacted = redactText(original, rules);
  if (redacted !== original) {
    fs.writeFileSync(filePath, redacted);
  }
}

function redactZip(zipPath: string, rules: Array<[RegExp, string]>): void {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-redact-'));
  try {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', workDir]);
    walk(workDir, (file) => redactFile(file, rules));
    fs.rmSync(zipPath);
    execFileSync('zip', ['-q', '-r', '-X', zipPath, '.'], { cwd: workDir });
  } catch (error) {
    fs.rmSync(zipPath, { force: true });
    console.error(`[redact] could not redact ${zipPath}; deleted it rather than leave it unredacted:`, error);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

export default function redactArtifacts(config: FullConfig): void {
  const rules = buildRules();
  const outputDirs = new Set(config.projects.map((project) => path.resolve(project.outputDir)));
  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    walk(dir, (file) => {
      if (file.endsWith('.zip')) {
        redactZip(file, rules);
      } else {
        redactFile(file, rules);
      }
    });
  }
}
