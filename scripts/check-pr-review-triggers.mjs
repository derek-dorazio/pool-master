import { spawnSync } from 'node:child_process';

const MARKER = '<!-- review:triggers -->';

const prNumber =
  process.argv[2] ??
  process.env.PR_NUMBER ??
  process.env.GITHUB_PR_NUMBER ??
  null;

if (!prNumber) {
  console.log(
    'Review triggers check: not running in a PR context (no PR number provided). Skipping.',
  );
  process.exit(0);
}

const result = spawnSync(
  'gh',
  ['pr', 'view', String(prNumber), '--json', 'body', '--jq', '.body'],
  { encoding: 'utf8' },
);

if (result.status !== 0) {
  console.error(`Failed to fetch PR #${prNumber}:`);
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const body = (result.stdout ?? '').toString();

if (!body.includes(MARKER)) {
  console.error(`PR #${prNumber} body is missing the review triggers marker.`);
  console.error('');
  console.error('Add a section like this to the PR body:');
  console.error('');
  console.error('    ## Review triggers');
  console.error('');
  console.error(`    ${MARKER}`);
  console.error('    None.');
  console.error('');
  console.error(
    'List anything this slice touched that warrants a closer read, or "None."',
  );
  console.error(
    'See rules/review-triggers.md for the trigger list and rules/workflow-rules.md §6.',
  );
  process.exit(1);
}

// Presence-enforced only. Whether the listed triggers are accurate and complete
// is not machine-checkable -- that is the honest limit of this gate, and the
// reason the mechanically-detectable rules stay as scanners instead.
console.log(`PR #${prNumber} contains the review triggers marker.`);
