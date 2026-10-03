#!/usr/bin/env node
/* global console, process, fetch */
/**
 * Post the failing output of a CI run's jobs into a tracking issue, so a red build is
 * diagnosable from the issue alone.
 *
 * #191 is the standing complaint: ten failed QA deploys in a row went unnoticed because a red
 * job on main surfaces nowhere. `deploy-health-issue` fixed the *noticing* — it keeps one issue
 * open while the deploy is failing — but the issue only ever carried which jobs were red, so
 * reading *why* still meant opening the run page. For the QA migrate task the real error is in
 * the container's CloudWatch log, relayed through the job log, which means anyone without AWS
 * or without a machine in front of them could not diagnose it at all. plans/147's collapse
 * migration hit exactly that.
 *
 * So this script reads each failed job's log through the Actions API and puts the tail of the
 * failure in the issue. It is deliberately generic: the issue is chosen by `--title` (found or
 * created) or by `--issue`, and the watched jobs by `--jobs`, so any tracking issue can be
 * served by adding a step that calls it. Nothing here knows about deploys.
 *
 * ## This repository is public, so everything posted is published
 *
 * Actions masks registered secrets in logs as `***` before this script ever sees them, but a
 * value assembled at runtime is not registered and not masked — a connection string in an
 * error message, an RDS endpoint, a bearer token echoed by a failing curl. `redactLogText`
 * therefore runs over every line before it reaches the issue, and the posted excerpt is capped
 * to the tail of the failing step rather than the whole log. Treat that function as the
 * security boundary of this feature: a pattern added there is the only thing standing between
 * a runtime-assembled credential and a public comment.
 *
 * Usage:
 *   node scripts/ci-failure-report.mjs --title "<issue title>" --jobs a,b,c \
 *     [--issue <number>] [--max-lines 80] [--managed-note "<footer>"] [--dry-run]
 *
 * Environment: GITHUB_TOKEN (issues: write, actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID,
 * GITHUB_SERVER_URL, GITHUB_SHA.
 */

import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

/** GitHub rejects an issue comment body over 65536 characters. */
export const COMMENT_BODY_LIMIT = 65536;

const DEFAULT_MAX_LINES = 80;

/**
 * Patterns redacted before any log text reaches a public issue. Ordered most specific first:
 * a credentialled URL is rewritten rather than blanked so the host stays readable, and the
 * broad token pattern runs last so it cannot eat a more precise match.
 *
 * Every entry exists because the value it matches is not a registered Actions secret and so is
 * not masked by the runner.
 */
const REDACTIONS = [
  // postgresql://user:password@host/db — the shape `local.db_url` builds for the migrate task.
  { pattern: /([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, replacement: '$1***:***@' },
  // key=value and "key": "value" for anything named like a credential. The name may carry a
  // prefix (`DB_PASSWORD`), and `_` is a word character, so this cannot anchor on \b alone.
  {
    pattern: /([\w.-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential))(["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi,
    replacement: '$1$2***',
  },
  { pattern: /\b(authorization|x-api-key)\b(\s*:\s*)(\S+)/gi, replacement: '$1$2***' },
  // AWS access key ids and account numbers inside ARNs.
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: '***' },
  { pattern: /(arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:)\d{12}(:)/gi, replacement: '$1***$2' },
  // Infrastructure the public does not need: RDS and other AWS endpoints, private addresses.
  { pattern: /\b[a-z0-9-]+\.[a-z0-9]+\.[a-z0-9-]+\.rds\.amazonaws\.com\b/gi, replacement: '***.rds.amazonaws.com' },
  { pattern: /\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '***.***.***.***' },
  { pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/g, replacement: '***.***.***.***' },
  { pattern: /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, replacement: '***.***.***.***' },
  // Email addresses: PII, and the owner's address appears in git metadata. The local part is a
  // real local-part class rather than "anything but @", so this cannot swallow the `user:pass@`
  // of a URL the first rule has already masked to `***:***@host`.
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}\b/gi, replacement: '***@***' },
  // A bare high-entropy blob: a JWT, a bearer token, anything long enough to be a key. Runs
  // last, and demands all three character classes with no underscore, so it does not eat an
  // identifier — a migration name like 20261003180000_collapse_season_into_event_year, or a
  // 40-character all-lowercase git SHA, which is not a secret anyway.
  {
    pattern: /\b(?=[A-Za-z0-9-]*[a-z])(?=[A-Za-z0-9-]*[A-Z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{40,}\b/g,
    replacement: '***',
  },
];

/** Every redaction applied to one chunk of log text. The security boundary — see the header. */
export function redactLogText(text) {
  return REDACTIONS.reduce(
    (current, { pattern, replacement }) => current.replace(pattern, replacement),
    String(text ?? ''),
  );
}

/**
 * The jobs this report is about. `watched` empty means every job in the run; otherwise names
 * are matched exactly, so a renamed job shows up as missing rather than silently unwatched.
 */
export function selectWatchedJobs(jobs, watched = []) {
  if (watched.length === 0) {
    return [...(jobs ?? [])];
  }
  const wanted = new Set(watched);
  return (jobs ?? []).filter((job) => wanted.has(job.name));
}

/**
 * The tri-state the caller acts on, preserving `deploy-health-issue`'s original behaviour:
 * any failure reports, all-success closes, and anything else — a skipped job, a run that did
 * not reach them — does nothing rather than closing an issue on an inconclusive run.
 */
export function verdictFor(jobs) {
  if (jobs.length === 0) {
    return 'inconclusive';
  }
  if (jobs.some((job) => job.conclusion === 'failure' || job.conclusion === 'timed_out')) {
    return 'failure';
  }
  if (jobs.every((job) => job.conclusion === 'success')) {
    return 'success';
  }
  return 'inconclusive';
}

/**
 * The part of a job log worth reading: the lines leading up to its last `##[error]`, or the
 * plain tail when it has none. Actions prefixes every line with an ISO timestamp and wraps
 * steps in `##[group]`/`##[endgroup]`. The timestamps and the markers go; the text *on* a group
 * line stays, because it is the command that was run.
 */
export function extractFailureTail(logText, maxLines = DEFAULT_MAX_LINES) {
  const lines = String(logText ?? '')
    .split('\n')
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ''))
    .filter((line) => !/^##\[endgroup\]/.test(line))
    .map((line) => line.replace(/^##\[group\]/, ''));

  const lastError = lines.reduce(
    (found, line, index) => (line.startsWith('##[error]') ? index : found),
    -1,
  );
  const end = lastError === -1 ? lines.length : lastError + 1;
  const window = lines.slice(Math.max(0, end - maxLines), end);

  // Trailing blanks are common and waste the budget; leading ones make the fence look broken.
  while (window.length > 0 && window[0].trim() === '') window.shift();
  while (window.length > 0 && window[window.length - 1].trim() === '') window.pop();
  return window.join('\n');
}

/** The steps that actually failed, for the one-line summary above each excerpt. */
export function failedStepNames(job) {
  return (job?.steps ?? [])
    .filter((step) => step.conclusion === 'failure' || step.conclusion === 'timed_out')
    .map((step) => step.name);
}

export function composeReport({ sha, runUrl, jobs, managedNote }) {
  const names = jobs.map((job) => `\`${job.name}\``).join(', ');
  const sections = jobs.map((job) => {
    const steps = failedStepNames(job);
    const where = steps.length > 0 ? ` — failing step: ${steps.map((step) => `\`${step}\``).join(', ')}` : '';
    // A gap is reported with its cause. "No log text could be read" on its own sends the reader
    // to the run page, which is the trip this whole script exists to save them.
    const excerpt = job.excerpt?.trim()
      ? `\n\`\`\`\n${job.excerpt}\n\`\`\`\n`
      : `\nNo log text could be read for this job${job.logError ? ` — ${job.logError}` : ''}. `
        + 'The run page has the full log.\n';
    return `<details>\n<summary><code>${job.name}</code>${where}</summary>\n${excerpt}\n</details>`;
  });

  const body = [
    `CI failed for \`${sha}\` — ${names || 'no job names resolved'}. Run: ${runUrl}`,
    '',
    'Log excerpts below, redacted and trimmed to the tail of each failure. This repository is '
      + 'public, so values that look like credentials, endpoints or addresses are masked; the '
      + 'run page has the unredacted log.',
    '',
    ...sections,
  ].join('\n');

  return managedNote ? `${body}\n\n${managedNote}` : body;
}

/**
 * Keeps a body inside GitHub's limit by dropping whole excerpts from the end, which is lossless
 * for the jobs that remain. Truncating mid-fence would leave an unterminated code block.
 */
export function truncateBody(body, limit = COMMENT_BODY_LIMIT) {
  if (body.length <= limit) {
    return body;
  }
  const notice = '\n\n_Some excerpts were dropped to fit GitHub\'s comment size limit. The run page has them all._';
  const sections = body.split('\n<details>');
  let kept = sections[0];
  for (const section of sections.slice(1)) {
    const candidate = `${kept}\n<details>${section}`;
    if (candidate.length + notice.length > limit) {
      break;
    }
    kept = candidate;
  }
  return `${kept.slice(0, limit - notice.length)}${notice}`;
}

export function parseArgs(argv) {
  const options = { jobs: [], maxLines: DEFAULT_MAX_LINES, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value.`);
      }
      index += 1;
      return value;
    };
    if (arg === '--title') options.title = next();
    else if (arg === '--issue') options.issue = Number.parseInt(next(), 10);
    else if (arg === '--jobs') options.jobs = next().split(',').map((name) => name.trim()).filter(Boolean);
    else if (arg === '--max-lines') options.maxLines = Number.parseInt(next(), 10);
    else if (arg === '--managed-note') options.managedNote = next();
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument ${arg}.`);
  }
  if (!options.title && !options.issue) {
    throw new Error('One of --title or --issue is required.');
  }
  return options;
}

async function api(path, { token, method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept,
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
  }
  return accept === 'application/vnd.github+json' ? response.json() : response.text();
}

async function readRunJobs(repo, runId, token) {
  const jobs = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`, { token });
    jobs.push(...result.jobs);
    if (jobs.length >= result.total_count || result.jobs.length === 0) {
      break;
    }
  }
  return jobs;
}

/**
 * A completed job's log. The endpoint redirects to a storage host, which `fetch` follows. A
 * failure here is reported in place of the excerpt rather than failing the report: a missing
 * log is worth less than the rest of the comment.
 */
/**
 * A completed job's log text.
 *
 * The redirect has to be followed by hand. The endpoint answers 302 with a pre-signed URL on a
 * storage host, and `fetch`'s automatic redirect forwards the `Authorization` header to it;
 * storage rejects a request that carries both its own signature and a bearer token, so the
 * first attempt at this returned nothing and the report said only "no log text could be read".
 * The second hop therefore carries no credentials of ours.
 *
 * A just-finished job can also 404 while its log is still being finalised, so a 404 is retried
 * once.
 */
async function fetchJobLog(repo, jobId, token) {
  const response = await fetch(`${API}/repos/${repo}/actions/jobs/${jobId}/logs`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
    redirect: 'manual',
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`the logs endpoint answered ${response.status} with no location header`);
    }
    const stored = await fetch(location);
    if (!stored.ok) {
      throw new Error(`log storage answered ${stored.status}: ${(await stored.text()).slice(0, 300)}`);
    }
    return stored.text();
  }

  if (!response.ok) {
    throw new Error(`the logs endpoint answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.text();
}

/**
 * The log, or the reason there isn't one. A missing log is worth less than the rest of the
 * comment, so this never fails the report — but it says what went wrong in the comment itself,
 * because a report that cannot explain its own gap is the problem this script exists to fix.
 */
async function readJobLog(repo, jobId, token) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return { text: await fetchJobLog(repo, jobId, token) };
    } catch (error) {
      const retryable = attempt === 1 && /answered 404/.test(error.message);
      if (!retryable) {
        console.log(`::warning::Could not read the log for job ${jobId}: ${error.message}`);
        return { text: '', error: error.message };
      }
      await new Promise((resolve) => { setTimeout(resolve, 5000); });
    }
  }
  return { text: '', error: 'unreachable' };
}

/**
 * The open issue with exactly this title, by listing rather than by `/search/issues`. Search is
 * an index with a lag of up to a minute, so a second failure soon after the first could miss the
 * issue it just created and open a duplicate. Listing is immediately consistent. The issues
 * endpoint also returns pull requests, which are not candidates.
 */
async function findIssueByTitle(repo, title, token) {
  for (let page = 1; page <= 5; page += 1) {
    const items = await api(`/repos/${repo}/issues?state=open&per_page=100&page=${page}`, { token });
    const match = items.find((item) => !item.pull_request && item.title === title);
    if (match) {
      return match.number;
    }
    if (items.length < 100) {
      return undefined;
    }
  }
  return undefined;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const sha = process.env.GITHUB_SHA ?? 'unknown';
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  if (!token || !repo || !runId) {
    throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID are required.');
  }
  const runUrl = `${serverUrl}/${repo}/actions/runs/${runId}`;

  const watched = selectWatchedJobs(await readRunJobs(repo, runId, token), options.jobs);
  const verdict = verdictFor(watched);
  const issue = options.issue ?? (options.title ? await findIssueByTitle(repo, options.title, token) : undefined);

  console.log(JSON.stringify({
    verdict,
    issue: issue ?? null,
    watched: watched.map((job) => ({ name: job.name, conclusion: job.conclusion })),
  }, null, 2));

  if (verdict === 'inconclusive') {
    console.log('Neither a clean failure nor a clean success. Leaving the issue as it is.');
    return;
  }

  if (verdict === 'success') {
    if (issue && !options.dryRun) {
      await api(`/repos/${repo}/issues/${issue}/comments`, {
        token,
        method: 'POST',
        body: { body: `Green again at \`${sha}\`. Run: ${runUrl}` },
      });
      await api(`/repos/${repo}/issues/${issue}`, {
        token,
        method: 'PATCH',
        body: { state: 'closed', state_reason: 'completed' },
      });
      console.log(`Closed #${issue}.`);
    }
    return;
  }

  const failed = watched.filter((job) => job.conclusion === 'failure' || job.conclusion === 'timed_out');
  for (const job of failed) {
    const { text, error } = await readJobLog(repo, job.id, token);
    job.excerpt = redactLogText(extractFailureTail(text, options.maxLines));
    // Redacted too: a storage error can quote the pre-signed URL, signature and all.
    job.logError = error ? redactLogText(error) : undefined;
  }

  const body = truncateBody(composeReport({
    sha,
    runUrl,
    jobs: failed,
    managedNote: issue ? undefined : options.managedNote,
  }));

  if (options.dryRun) {
    console.log(body);
    return;
  }

  if (issue) {
    await api(`/repos/${repo}/issues/${issue}/comments`, { token, method: 'POST', body: { body } });
    console.log(`Commented on #${issue}.`);
  } else {
    const created = await api(`/repos/${repo}/issues`, {
      token,
      method: 'POST',
      body: { title: options.title, body },
    });
    console.log(`Opened #${created.number}.`);
  }
  console.log(`::error::CI failed — ${failed.map((job) => job.name).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
