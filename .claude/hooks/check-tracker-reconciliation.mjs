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
 * TWO TRANSPORTS, because the sessions that matter do not all look alike:
 *
 *   - `gh` CLI when it is installed (developer machines).
 *   - `curl` against the REST API otherwise. Claude Code cloud containers have
 *     no `gh` binary, so a gh-only version of this hook was silently inert in
 *     exactly the environment most sessions run in -- it looked like a safety
 *     net and never fired once.
 *
 * `curl` rather than Node's global fetch, deliberately: fetch ignores
 * HTTPS_PROXY unless started with the experimental NODE_USE_ENV_PROXY, and this
 * environment's egress goes through an agent proxy. curl honors the proxy with
 * no flag. See sendsAuth() for why the token is usually NOT forwarded.
 *
 * IT DOES NOT FAIL SILENTLY. When the check cannot run -- no transport, no
 * network, unreadable remote -- it says so and names the reason. Silence is
 * reserved for exactly one case: the check ran and found nothing. That
 * distinction is the point. An earlier version treated "could not check" and
 * "nothing to report" as the same empty output, so a missing `gh` binary
 * rendered the hook inert for weeks without a single visible symptom.
 *
 * Cost is one issue listing per session Stop, regardless of how many plans exist.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TIMEOUT_MS = 5000;
const MAX_PAGES = 5;
const PER_PAGE = 100;

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

function toIssueMap(records) {
  return new Map(
    records.map((i) => [i.number, { state: String(i.state).toUpperCase(), title: i.title }]),
  );
}

/** Transport 1: the gh CLI. Already filters pull requests out for us. */
function loadViaGh() {
  const out = run('gh', [
    'issue', 'list',
    '--state', 'all',
    '--limit', String(MAX_PAGES * PER_PAGE),
    '--json', 'number,state,title',
  ]);
  if (!out) return null;
  try {
    return toIssueMap(JSON.parse(out));
  } catch {
    return null;
  }
}

/** owner/repo from the origin remote, https or ssh form. */
function repoSlug() {
  const url = run('git', ['remote', 'get-url', 'origin']);
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Only forward a token that actually looks like a GitHub credential.
 *
 * Claude Code cloud containers export GH_TOKEN/GITHUB_TOKEN as a *proxy
 * sentinel* (it starts with "prox"), not a real token -- the agent proxy
 * injects the genuine credential on the way out. Forwarding the sentinel as a
 * bearer token makes GitHub return 401 and the hook go quiet, which is the
 * failure this whole fallback exists to remove. When the value is not a real
 * token we send no Authorization header and let the proxy do its job.
 */
function authHeaderArgs() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token || !/^(gh[pousr]_|github_pat_)/.test(token)) return [];
  return ['-H', `Authorization: Bearer ${token}`];
}

/** Transport 2: REST API via curl. Used where `gh` is absent. */
function loadViaApi() {
  const slug = repoSlug();
  if (!slug) return null;

  const records = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const out = run('curl', [
      '-sS', '--fail', '--max-time', String(TIMEOUT_MS / 1000),
      ...authHeaderArgs(),
      '-H', 'Accept: application/vnd.github+json',
      '-H', 'User-Agent: poolmaster-tracker-reconciliation-hook',
      `https://api.github.com/repos/${slug}/issues?state=all&per_page=${PER_PAGE}&page=${page}`,
    ]);
    if (!out) return null;

    let batch;
    try {
      batch = JSON.parse(out);
    } catch {
      return null;
    }
    if (!Array.isArray(batch)) return null;

    // /issues returns pull requests too -- they carry a `pull_request` key.
    // Without this filter a plan tracking, say, #141 would resolve against a PR
    // of that number instead of the issue. `gh issue list` does this for us.
    records.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < PER_PAGE) break;
  }
  return toIssueMap(records);
}

/** -> { issues: Map } on success, { error: '<reason>' } when the check cannot run. */
function loadIssues() {
  const viaGh = loadViaGh();
  if (viaGh) return { issues: viaGh };

  if (!repoSlug()) {
    return { error: 'could not derive owner/repo from the `origin` remote' };
  }
  const viaApi = loadViaApi();
  if (viaApi) return { issues: viaApi };

  return {
    error:
      '`gh` is unavailable or failed, and the curl call to api.github.com returned nothing usable '
      + '(no curl, no network, auth rejected, or malformed JSON)',
  };
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

/** The hook's only output channel. Always exits 0 -- this reports, never gates. */
function emit(text) {
  process.stdout.write(JSON.stringify({ systemMessage: text }));
}

function skip(reason) {
  emit(
    'Tracker reconciliation DID NOT RUN.\n'
    + `  Reason: ${reason}\n`
    + '  This check reports drift between plans/ and the issue tracker '
    + '(workflow-rules.md §1, §5). While it is skipped, that drift is unchecked — '
    + 'a silent skip is what let this hook sit inert once already (#143).',
  );
}

function main() {
  if (!run('git', ['rev-parse', '--git-dir'])) {
    skip('not inside a git repository');
    return;
  }

  const { issues, error } = loadIssues();
  if (error) {
    skip(error);
    return;
  }

  const lines = [];

  for (const number of issuesReferencedByBranchCommits()) {
    const issue = issues.get(number);
    if (issue?.state === 'OPEN') {
      lines.push(`  #${number} is still open — "${issue.title}"`);
    }
  }

  for (const { file, issue } of plansWithTrackingIssues()) {
    if (issue === null) {
      lines.push(`  plans/${file} declares no tracking issue (workflow-rules.md §5)`);
      continue;
    }
    const state = issues.get(issue);
    if (state && state.state !== 'OPEN') {
      lines.push(`  plans/${file} tracks #${issue}, which is closed — delete the plan (ADR-0002)`);
    }
  }

  // The one silent case: the check ran and there is nothing to say.
  if (lines.length === 0) return;

  emit(
    'Tracker reconciliation (reminder, not a gate):\n'
    + lines.join('\n')
    + '\nAn issue a PR will close via `Closes #NN` on merge is expected to read open here.',
  );
}

main();
