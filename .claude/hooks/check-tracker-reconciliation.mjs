#!/usr/bin/env node
/**
 * Stop hook — tracker reconciliation reminder.
 *
 * Two drift checks, both of which the workflow previously asked an agent to
 * remember at closeout (rules/workflow-rules.md §1, §5):
 *
 *   1. An issue referenced by this branch's commits is still open.
 *   2. A plan file's tracking issue is closed or missing — per ADR-0002 the
 *      plan should have been deleted, or per §5 the issue should exist.
 *
 * This is a REMINDER, NOT A GATE. It always exits 0. It cannot tell a
 * genuinely-unfinished issue from one a `Closes #NN` in an unmerged PR body
 * will close on merge -- the open state is correct in that case. Blocking on
 * a signal that is legitimately noisy trains people to bypass the hook, so it
 * only ever prints.
 *
 * Degrades silently: no `gh`, no auth, no network, not a repo -> no output.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TIMEOUT_MS = 5000;

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** number -> { state, title }, or null if the issue could not be read. */
function readIssue(number) {
  const out = run('gh', ['issue', 'view', String(number), '--json', 'number,state,title']);
  if (!out) return null;
  try {
    const parsed = JSON.parse(out);
    return { state: String(parsed.state).toUpperCase(), title: parsed.title };
  } catch {
    return null;
  }
}

function issuesReferencedByBranchCommits() {
  const log = run('git', ['log', 'origin/main..HEAD', '--pretty=%B']);
  if (!log) return [];
  // Deliberately not matching inside URLs (e.g. .../pull/12), which are not
  // issue references from this repo's footer convention.
  const found = new Set();
  for (const m of log.matchAll(/(^|[^/\w])#(\d{1,6})\b/g)) found.add(Number(m[2]));
  return [...found].sort((a, b) => a - b);
}

function plansWithTrackingIssues() {
  let files;
  try {
    files = readdirSync('plans').filter((f) => /^\d+-.*\.md$/.test(f));
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    let head;
    try {
      head = readFileSync(join('plans', file), 'utf8').split('\n').slice(0, 15).join('\n');
    } catch {
      continue;
    }
    const m = head.match(/\*\*Tracking issue:\*\*\s*#(\d{1,6})/);
    out.push({ file, issue: m ? Number(m[1]) : null });
  }
  return out;
}

function main() {
  if (!run('git', ['rev-parse', '--git-dir'])) return;
  if (!run('gh', ['auth', 'status'])) return;

  const lines = [];

  for (const number of issuesReferencedByBranchCommits()) {
    const issue = readIssue(number);
    if (issue?.state === 'OPEN') {
      lines.push(`  #${number} is still open — "${issue.title}"`);
    }
  }

  for (const { file, issue } of plansWithTrackingIssues()) {
    if (issue === null) {
      lines.push(`  plans/${file} declares no tracking issue (workflow-rules.md §5)`);
      continue;
    }
    const state = readIssue(issue);
    if (state && state.state !== 'OPEN') {
      lines.push(`  plans/${file} tracks #${issue}, which is closed — delete the plan (ADR-0002)`);
    }
  }

  if (lines.length === 0) return;

  process.stdout.write(
    JSON.stringify({
      systemMessage:
        'Tracker reconciliation (reminder, not a gate):\n' +
        lines.join('\n') +
        '\nAn issue a PR will close via `Closes #NN` on merge is expected to read open here.',
    }),
  );
}

main();
