import { spawnSync } from 'node:child_process';

const MARKER = '<!-- review:triggers -->';

// #284 — advisory, not blocking. This script never exits non-zero on a missing or unreadable
// section; it emits a GitHub warning annotation instead.
//
// The section is still expected on every PR, and the PR template still carries it. What changed
// is the consequence of forgetting it. Two reasons:
//
//   1. The check can only verify the marker is *present*. Whether the listed triggers are
//      accurate or complete is not machine-checkable (see rules/review-triggers.md §4), so a
//      failure here never meant the disclosure was good -- only that a string existed.
//   2. This step runs inside all-contract-gates, which every other job in ci.yml declares in
//      `needs:`. A hard failure therefore withheld all twelve downstream jobs: on #283 an
//      11-line Terraform change got no lint, typecheck or test verdict at all because a prose
//      section was missing. A presence check should not be able to veto the whole build.
//
// The guidance text below is the part that was actually doing the work, so it is kept verbatim.
function warn(summary, details) {
  // One-line annotation (GitHub needs %0A for newlines in annotations); details go to the log,
  // where they are readable without the Annotations pane.
  console.log(`::warning title=Review triggers::${summary}`);
  for (const line of details) {
    console.log(line);
  }
}

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
  // An advisory check that cannot read the body reports that it could not look, and passes.
  // Failing here would reintroduce exactly the blast radius #284 removed, for a reason that is
  // not even about the PR's content.
  warn(
    `Could not fetch PR #${prNumber} to check for the review triggers marker; not checked.`,
    result.stderr ? [result.stderr.trim()] : [],
  );
  process.exit(0);
}

const body = (result.stdout ?? '').toString();

if (!body.includes(MARKER)) {
  warn(`PR #${prNumber} body is missing the review triggers marker.`, [
    '',
    'Add a section like this to the PR body:',
    '',
    '    ## Review triggers',
    '',
    `    ${MARKER}`,
    '    None.',
    '',
    'List anything this slice touched that warrants a closer read, or "None."',
    'See rules/review-triggers.md for the trigger list and rules/workflow-rules.md §6.',
    '',
    'This is a warning, not a failure: the section is expected but is not enforced.',
  ]);
  process.exit(0);
}

// Presence-reported only. Whether the listed triggers are accurate and complete
// is not machine-checkable -- that is the honest limit of this check, and the
// reason the mechanically-detectable rules stay as scanners instead.
console.log(`PR #${prNumber} contains the review triggers marker.`);
