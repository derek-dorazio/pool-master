import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMMENT_BODY_LIMIT,
  composeReport,
  extractFailureTail,
  failedStepNames,
  parseArgs,
  redactLogText,
  selectWatchedJobs,
  truncateBody,
  verdictFor,
} from './ci-failure-report.mjs';

/**
 * #191 — the report that makes a red build diagnosable from its issue.
 *
 * `redactLogText` carries most of the weight here. This repository is public, so every line the
 * report posts is published; Actions masks registered secrets before the script sees them, but
 * a value assembled at runtime — the migrate task's connection string, an RDS endpoint, a token
 * echoed by a failing request — is not registered and not masked. These cases are the contract.
 */
describe('ci-failure-report redaction (public repository)', () => {
  it('keeps a connection string\'s host but removes its credentials', () => {
    const redacted = redactLogText('postgresql://poolmaster:s3cr3t-pw@db.internal:5432/poolmaster');
    assert.equal(redacted, 'postgresql://***:***@db.internal:5432/poolmaster');
    assert.ok(!redacted.includes('s3cr3t-pw'));
  });

  it('masks credential-named key/value pairs in either syntax', () => {
    assert.match(redactLogText('DB_PASSWORD=hunter2'), /DB_PASSWORD=\*\*\*/);
    assert.match(redactLogText('{"token": "abc123def"}'), /"token":\s*"?\*\*\*/);
    assert.match(redactLogText('api_key: zzz999'), /api_key:\s*\*\*\*/);
    assert.match(redactLogText('Authorization: Bearer xyz'), /Authorization:\s*\*\*\*/);
  });

  it('masks AWS identifiers and the account number inside an ARN', () => {
    assert.match(redactLogText('key AKIAIOSFODNN7EXAMPLE used'), /key \*\*\* used/);
    assert.equal(
      redactLogText('arn:aws:ecs:us-east-2:123456789012:task/abc'),
      'arn:aws:ecs:us-east-2:***:task/abc',
    );
  });

  it('masks infrastructure addresses the public does not need', () => {
    assert.equal(
      redactLogText('at poolmaster-qa-postgres.cabcdefghij.us-east-2.rds.amazonaws.com:5432'),
      'at ***.rds.amazonaws.com:5432',
    );
    assert.match(redactLogText('host 10.0.3.47 refused'), /host \*\*\*\.\*\*\*\.\*\*\*\.\*\*\* refused/);
    assert.match(redactLogText('host 172.31.0.9 refused'), /host \*\*\*\.\*\*\*\.\*\*\*\.\*\*\* refused/);
    assert.match(redactLogText('host 192.168.1.5 refused'), /host \*\*\*\.\*\*\*\.\*\*\*\.\*\*\* refused/);
  });

  it('masks email addresses, which are PII and appear in git metadata', () => {
    assert.match(redactLogText('author someone@example.com committed'), /author \*\*\*@\*\*\* committed/);
  });

  it('masks a bare high-entropy blob, which could be any kind of key', () => {
    const jwtish = 'eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuvwxyz0123456789';
    assert.equal(redactLogText(`token ${jwtish}`), 'token ***');
  });

  // A public IP, a short word and a SHA are not secrets, and masking them would make the
  // excerpt useless. 40 characters is the floor for the high-entropy pattern, so a 40-char
  // git SHA is intentionally *not* excluded — but the 8- and 12-char forms CI prints are.
  it('leaves ordinary log text alone', () => {
    const line = 'Applying migration 20261003180000_collapse_season_into_event_year at 4d777af6';
    assert.equal(redactLogText(line), line);
    assert.equal(redactLogText('listening on 0.0.0.0:3000'), 'listening on 0.0.0.0:3000');
  });

  it('leaves values the runner already masked as they are', () => {
    assert.equal(redactLogText('PASSWORD=***'), 'PASSWORD=***');
  });
});

describe('ci-failure-report log excerpting', () => {
  const log = [
    '2026-10-03T20:05:14.1234567Z ##[group]Run node scripts/x.mjs',
    '2026-10-03T20:05:14.2000000Z first line',
    '2026-10-03T20:05:14.3000000Z ##[endgroup]',
    '2026-10-03T20:05:15.0000000Z the interesting error',
    '2026-10-03T20:05:15.1000000Z ##[error]Process completed with exit code 1.',
    '2026-10-03T20:05:16.0000000Z noise after the failure',
  ].join('\n');

  it('strips timestamps and group markers and ends at the last error', () => {
    assert.equal(
      extractFailureTail(log),
      'Run node scripts/x.mjs\nfirst line\nthe interesting error\n##[error]Process completed with exit code 1.',
    );
  });

  it('honours the line budget, keeping the lines nearest the failure', () => {
    assert.equal(extractFailureTail(log, 2), 'the interesting error\n##[error]Process completed with exit code 1.');
  });

  it('falls back to the plain tail when the log has no error marker', () => {
    assert.equal(extractFailureTail('2026-10-03T20:05:14.0000000Z only line'), 'only line');
  });

  it('returns empty for an unreadable log rather than throwing', () => {
    assert.equal(extractFailureTail(''), '');
    assert.equal(extractFailureTail(undefined), '');
  });
});

describe('ci-failure-report job selection and verdict', () => {
  const jobs = [
    { name: 'a', conclusion: 'success' },
    { name: 'b', conclusion: 'failure' },
    { name: 'c', conclusion: 'skipped' },
  ];

  it('watches every job when none are named', () => {
    assert.equal(selectWatchedJobs(jobs).length, 3);
  });

  it('matches watched names exactly, so a rename reads as missing', () => {
    assert.deepEqual(selectWatchedJobs(jobs, ['a', 'b']).map((job) => job.name), ['a', 'b']);
    assert.deepEqual(selectWatchedJobs(jobs, ['renamed']), []);
  });

  it('reports failure for any failed or timed-out job', () => {
    assert.equal(verdictFor([{ conclusion: 'success' }, { conclusion: 'failure' }]), 'failure');
    assert.equal(verdictFor([{ conclusion: 'timed_out' }]), 'failure');
  });

  it('reports success only when every watched job succeeded', () => {
    assert.equal(verdictFor([{ conclusion: 'success' }, { conclusion: 'success' }]), 'success');
  });

  // Closing an issue because a run skipped the jobs that prove health is how #191 stayed
  // invisible. A skip is not news.
  it('reports inconclusive for a skipped job or an empty set, so no issue is closed', () => {
    assert.equal(verdictFor([{ conclusion: 'success' }, { conclusion: 'skipped' }]), 'inconclusive');
    assert.equal(verdictFor([]), 'inconclusive');
  });

  it('names only the steps that failed', () => {
    const job = {
      steps: [
        { name: 'checkout', conclusion: 'success' },
        { name: 'Wait for migration to complete', conclusion: 'failure' },
      ],
    };
    assert.deepEqual(failedStepNames(job), ['Wait for migration to complete']);
    assert.deepEqual(failedStepNames({}), []);
  });
});

describe('ci-failure-report body composition', () => {
  it('names the failing step and fences the excerpt', () => {
    const body = composeReport({
      sha: '4d777af6',
      runUrl: 'https://example.invalid/run/1',
      jobs: [{
        name: 'deploy-migrate-qa',
        steps: [{ name: 'Wait for migration to complete', conclusion: 'failure' }],
        excerpt: 'plans/147: 1 sport_events have no season',
      }],
    });
    assert.match(body, /`4d777af6`/);
    assert.match(body, /<summary><code>deploy-migrate-qa<\/code> — failing step: `Wait for migration to complete`<\/summary>/);
    assert.match(body, /```\nplans\/147: 1 sport_events have no season\n```/);
    assert.match(body, /repository is public/);
  });

  it('says so plainly when a log could not be read', () => {
    const body = composeReport({ sha: 'x', runUrl: 'u', jobs: [{ name: 'j', excerpt: '' }] });
    assert.match(body, /No log text could be read/);
  });

  // The first run of this feature posted a bare "no log text could be read", which sent the
  // reader to the run page — the trip the script exists to save. A gap carries its cause now.
  it('names the reason a log could not be read', () => {
    const body = composeReport({
      sha: 'x',
      runUrl: 'u',
      jobs: [{ name: 'j', excerpt: '', logError: 'log storage answered 403: InvalidAuthenticationInfo' }],
    });
    assert.match(body, /No log text could be read for this job — log storage answered 403/);
  });

  it('drops whole excerpts rather than cutting a code fence open', () => {
    const excerpt = 'x'.repeat(40_000);
    const body = composeReport({
      sha: 'x',
      runUrl: 'u',
      jobs: [
        { name: 'one', excerpt },
        { name: 'two', excerpt },
      ],
    });
    const truncated = truncateBody(body);
    assert.ok(truncated.length <= COMMENT_BODY_LIMIT);
    assert.match(truncated, /excerpts were dropped/);
    assert.equal((truncated.match(/```/g) ?? []).length % 2, 0);
  });

  it('leaves a body inside the limit untouched', () => {
    assert.equal(truncateBody('short'), 'short');
  });
});

describe('ci-failure-report arguments', () => {
  it('needs an issue to write to', () => {
    assert.throws(() => parseArgs([]), /One of --title or --issue is required/);
  });

  it('reads the title, jobs, issue and flags', () => {
    const options = parseArgs(['--title', 'QA deploy is failing on main', '--jobs', 'a, b', '--max-lines', '20', '--dry-run']);
    assert.equal(options.title, 'QA deploy is failing on main');
    assert.deepEqual(options.jobs, ['a', 'b']);
    assert.equal(options.maxLines, 20);
    assert.equal(options.dryRun, true);
  });

  it('rejects an unknown flag and a flag with no value', () => {
    assert.throws(() => parseArgs(['--nope']), /Unknown argument --nope/);
    assert.throws(() => parseArgs(['--title']), /--title needs a value/);
  });
});
