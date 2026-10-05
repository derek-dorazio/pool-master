// #300 — classifies a PR's changed files into the CI areas they can affect, so jobs that cannot
// be affected are skipped. See plans/146-ci-path-filtered-jobs.md.
//
// The whole design rests on one asymmetry: running a suite needlessly costs a few minutes, while
// skipping one that was needed puts a defect on main with a green check beside it. So every rule
// here fails TOWARD running. A path nobody classified runs everything; an empty or unreadable file
// list runs everything.
//
// Jobs are gated with a job-level `if:` on these outputs, never with `on.pull_request.paths`. A
// workflow filtered at the trigger level creates no check run at all, and a required check with no
// check run reports "Expected - waiting for status to be reported" forever, so the PRs this exists
// to speed up would become the only ones that cannot merge. A job skipped by `if:` does produce a
// check run, with conclusion `skipped`, which branch protection treats as satisfied.
//
// CLI: node scripts/ci-changed-areas.mjs <file-list-path>
// Writes `code=`, `service=` and `client=` lines to $GITHUB_OUTPUT, and a human summary to stdout.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Documentation and narrative only. A change confined to these cannot break a build or a test,
// so it skips every code job. all-contract-gates still runs and still covers what these CAN
// break: the rule scanners, and #147's plan-reference scanner.
const DOC_ONLY_PREFIXES = [
  'docs/',
  'plans/',
  'rules/',
  'requirements/',
  'tech-specs/',
  '.github/ISSUE_TEMPLATE/',
];

const DOC_ONLY_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
];

// Shared build inputs: a dependency bump, a tsconfig or lint change, a workflow edit or a change
// to the scripts the suites execute can break anything, so these force every area on.
const EVERYTHING_PREFIXES = [
  '.github/workflows/',
  'scripts/',
];

const EVERYTHING_FILES = [
  'package.json',
  'package-lock.json',
  'turbo.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'eslint.config.js',
];

const SERVICE_PREFIXES = [
  'packages/core-api/',
  'packages/shared/',
  'packages/mock-contest-feed-provider/',
  'tests/',
  'eslint-rules/',
];

const CLIENT_PREFIXES = [
  'clients/',
  // packages/shared is in BOTH lists deliberately: the client consumes it through the generated
  // SDK, so a shared change can break client code. It was service-only until #303, whose
  // packages/shared/domain change skipped poolmaster-unit-tests -- the first qualifying PR found
  // the gap, so the gap is widened rather than documented.
  'packages/shared/',
];

function matches(file, prefixes, files) {
  return prefixes.some((p) => file.startsWith(p)) || files.includes(file);
}

const isDocOnly = (file) => matches(file, DOC_ONLY_PREFIXES, DOC_ONLY_FILES);
const forcesEverything = (file) => matches(file, EVERYTHING_PREFIXES, EVERYTHING_FILES);
const isService = (file) => matches(file, SERVICE_PREFIXES, []);
const isClient = (file) => matches(file, CLIENT_PREFIXES, []);

/**
 * Returns { code, service, client, reason }. `code` gates lint, typecheck and build;
 * `service` and `client` gate the test suites.
 *
 * An empty list means we could not determine what changed, which is not the same as "nothing
 * changed" — it runs everything.
 */
export function classifyChanges(files) {
  if (!files || files.length === 0) {
    return { code: true, service: true, client: true, reason: 'no file list; running everything' };
  }

  if (files.every(isDocOnly)) {
    return { code: false, service: false, client: false, reason: 'documentation and narrative only' };
  }

  if (files.some(forcesEverything)) {
    return { code: true, service: true, client: true, reason: 'shared build input changed' };
  }

  let service = files.some(isService);
  let client = files.some(isClient);

  // A path that is neither documentation nor anything we classified is unknown, and unknown runs
  // everything. This is the branch that keeps a new top-level directory from silently skipping
  // the suites.
  const unclassified = files.filter((f) => !isDocOnly(f) && !isService(f) && !isClient(f));
  if (unclassified.length > 0) {
    service = true;
    client = true;
  }

  return {
    code: true,
    service,
    client,
    reason: unclassified.length > 0
      ? `unclassified path(s), running everything: ${unclassified.slice(0, 3).join(', ')}`
      : `service=${service} client=${client}`,
  };
}

function main(argv) {
  const listPath = argv[0];
  let files = [];
  if (listPath && fs.existsSync(listPath)) {
    files = fs.readFileSync(listPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  }

  const { code, service, client, reason } = classifyChanges(files);

  console.log(`${files.length} changed file(s); ${reason}`);
  console.log(`  code=${code} service=${service} client=${client}`);
  if (files.length > 0 && files.length <= 40) {
    for (const f of files) console.log(`    ${f}`);
  }

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    fs.appendFileSync(out, `code=${code}\nservice=${service}\nclient=${client}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
