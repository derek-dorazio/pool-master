import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { readAdminIdentifier } from './helpers/admin-session';
import { GENERATED_PASSWORD_PREFIX } from './helpers/constants';

/**
 * #278 — keeps traces on while keeping credentials out of uploaded artifacts.
 *
 * A Playwright trace records every fill() value, every step title, and every request and
 * response body, so a failing run against QA would otherwise publish the admin's identifier
 * and password, its account email, and a live session token. This runs as the config's
 * globalTeardown: after the traces are written to the output directory and before the HTML
 * reporter copies them into its report, so both get the scrubbed copy.
 *
 * Why it exists is the post-deploy smoke, which signs in with the real QA admin password. The
 * pre-merge job's admin password is generated per run and its users are deleted, so a leak
 * there is harmless; it runs everywhere only so one config serves both. Do not remove it on
 * the strength of the pre-merge job alone.
 *
 * It is a denylist: it removes the shapes listed in buildRules() and nothing else, so a new
 * kind of credential needs a new rule. Each file is redacted as text, kept as recognised
 * media, or deleted; a trace that cannot be rewritten is deleted rather than left unredacted.
 */

const REDACTED = '[REDACTED]';

// Binary formats a run legitimately produces: screenshots, the trace's screencast frames,
// video and snapshot fonts. Recognised by signature, not extension, because a trace's
// resources/ entries often have none. They cannot carry text, so they are kept as-is.
const MEDIA_SIGNATURES: Array<{ offset: number; bytes: number[] }> = [
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }, // PNG
  { offset: 0, bytes: [0xff, 0xd8, 0xff] }, // JPEG
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF
  { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP (inside RIFF)
  { offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // WebM / Matroska
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // MP4 (ftyp)
  { offset: 0, bytes: [0x77, 0x4f, 0x46, 0x46] }, // WOFF
  { offset: 0, bytes: [0x77, 0x4f, 0x46, 0x32] }, // WOFF2
  { offset: 0, bytes: [0x00, 0x01, 0x00, 0x00] }, // TrueType
  { offset: 0, bytes: [0x4f, 0x54, 0x54, 0x4f] }, // OpenType
];

class UnredactableFileError extends Error {}

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
    // Credential and token fields in request and response bodies. Two forms, each consuming
    // the whole value including escapes: raw JSON ("key":"v\"al"), and JSON embedded in a
    // JSON string (\"key\":\"v\\\"al\"), as a trace stores request and response bodies.
    [
      new RegExp(`("(?:${SENSITIVE_JSON_KEYS})"\\s*:\\s*")(?:[^"\\\\]|\\\\.)*`, 'g'),
      `$1${REDACTED}`,
    ],
    [
      new RegExp(
        `(\\\\"(?:${SENSITIVE_JSON_KEYS})\\\\"\\s*:\\s*\\\\")(?:[^"\\\\]|\\\\\\\\(?:\\\\"|\\\\\\\\|[^"\\\\]))*`,
        'g',
      ),
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

type Redact = (text: string) => string;

/**
 * `keep` holds names that are references, not data: a trace's own entry names, such as
 * screencast frames `page@<id>-<ts>.jpeg` and sources `src@<sha1>.txt`, which the email
 * rule would otherwise match, cutting the trace off from its own frames. They are swapped
 * out before the rules run and restored after.
 */
function textRedactor(rules: Array<[RegExp, string]>, keep: string[] = []): Redact {
  const placeholder = (index: number) => `\u0001KEEP${index}\u0001`;
  return (text) => {
    let current = keep.reduce((acc, name, index) => acc.split(name).join(placeholder(index)), text);
    current = rules.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), current);
    return keep.reduce((acc, name, index) => acc.split(placeholder(index)).join(name), current);
  };
}

function isMedia(buffer: Buffer): boolean {
  return MEDIA_SIGNATURES.some(({ offset, bytes }) =>
    buffer.length >= offset + bytes.length && bytes.every((byte, index) => buffer[offset + index] === byte),
  );
}

function decodeText(buffer: Buffer): string | null {
  if (buffer.includes(0)) {
    return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Every file takes exactly one of three paths: text is redacted, recognised media is kept,
 * and anything else is unredactable — the caller deletes the artifact rather than keep it.
 */
function redactFile(filePath: string, redact: Redact): void {
  const buffer = fs.readFileSync(filePath);
  const text = decodeText(buffer);
  if (text !== null) {
    const redacted = redact(text);
    if (redacted !== text) {
      fs.writeFileSync(filePath, redacted);
    }
    return;
  }
  if (isMedia(buffer)) {
    return;
  }
  throw new UnredactableFileError(`neither text nor a recognised media format: ${filePath}`);
}

function redactZip(zipPath: string, rules: Array<[RegExp, string]>): void {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-redact-'));
  try {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', workDir]);
    const entryNames: string[] = [];
    walk(workDir, (file) => entryNames.push(path.basename(file)));
    const redact = textRedactor(rules, entryNames);
    walk(workDir, (file) => redactFile(file, redact));
    fs.rmSync(zipPath);
    execFileSync('zip', ['-q', '-r', '-X', '-D', zipPath, '.'], { cwd: workDir });
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

function hasZipTools(): boolean {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export default function redactArtifacts(config: FullConfig): void {
  const rules = buildRules();
  const redact = textRedactor(rules);
  // Checked once, up front: without zip and unzip no trace can be rewritten, and per-trace
  // errors are easy to miss. Every trace is still deleted, and the run fails saying why.
  const zipTools = hasZipTools();
  let tracesDeletedForMissingTools = 0;
  const outputDirs = new Set(config.projects.map((project) => path.resolve(project.outputDir)));
  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    walk(dir, (file) => {
      if (file.endsWith('.zip')) {
        if (zipTools) {
          redactZip(file, rules);
        } else {
          fs.rmSync(file, { force: true });
          tracesDeletedForMissingTools += 1;
        }
        return;
      }
      try {
        redactFile(file, redact);
      } catch (error) {
        fs.rmSync(file, { force: true });
        console.error(`[redact] deleted ${file} rather than keep it unredacted:`, error);
      }
    });
  }
  if (tracesDeletedForMissingTools > 0) {
    throw new Error(
      `[redact] zip/unzip not found, so ${tracesDeletedForMissingTools} trace(s) could not be redacted and were deleted. Install zip and unzip to keep traces.`,
    );
  }
}
