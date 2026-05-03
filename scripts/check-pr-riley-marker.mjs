import { spawnSync } from 'node:child_process';

const MARKER = '<!-- riley:findings -->';

const prNumber =
  process.argv[2] ??
  process.env.PR_NUMBER ??
  process.env.GITHUB_PR_NUMBER ??
  null;

if (!prNumber) {
  console.log(
    'Riley findings marker check: not running in a PR context (no PR number provided). Skipping.',
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
  console.error(`PR #${prNumber} body is missing the Riley findings marker.`);
  console.error('');
  console.error('Add a section like this to the PR body:');
  console.error('');
  console.error('    ## Riley findings');
  console.error('');
  console.error(`    ${MARKER}`);
  console.error('    No findings.');
  console.error('');
  console.error(
    'Replace "No findings." with the findings table once Riley has reviewed.',
  );
  console.error(
    'See rules/workflow-rules.md §6 and personas/riley.md for the marker format.',
  );
  process.exit(1);
}

console.log(`PR #${prNumber} contains the Riley findings marker.`);
