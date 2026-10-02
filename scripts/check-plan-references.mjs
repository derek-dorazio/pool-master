/**
 * #147 — a permanent document may cite a plan only if the citation survives the plan's deletion.
 *
 * Plans are slice-life: `plans/NN-*.md` is deleted when its epic closes (ADR-0002). A permanent
 * document that cites one becomes a dangling pointer on a schedule, and reads as authoritative
 * the whole time (`rules/workflow-rules.md` §0, governing rule 2). Git is the archive, so the
 * citation that survives is the one carrying its own retrieval command:
 *
 *     - `plans/115-rule-enforcement-hardening.md` — … Retrieve via
 *       `git show 34ce656f^:plans/115-rule-enforcement-hardening.md`
 *
 * WHAT FAILS. A `plans/NN` reference in a permanent path whose plan is absent from the working
 * tree AND which has no `git show <rev>:plans/NN…` for the same plan within HINT_WINDOW lines.
 * A citation of a plan that still exists is latent, not broken, and passes: it becomes a
 * finding on the day the plan is deleted, which is when the hint's SHA first exists to write.
 *
 * WHAT IT DOES NOT CHECK. That the hint's revision resolves. CI checks out shallow, so a real
 * SHA and an invented one look the same there; that is a reviewer's job, done with full history.
 *
 * WHY docs/adr IS EXEMPT. Accepted ADRs are immutable, so a finding there could never be fixed,
 * and ADR-0002 explicitly accepts git retrieval for an ADR's historical references.
 */
import { existsSync, readdirSync } from 'node:fs';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readTextFile, reportFindings, walkFiles } from './rule-check-utils.mjs';

export const PERMANENT_ROOTS = ['docs', 'rules', 'requirements', 'tech-specs', 'AGENTS.md', 'CLAUDE.md'];
const EXEMPT_PREFIXES = ['docs/adr/'];
export const HINT_WINDOW = 3;

const PLAN_REFERENCE = /\bplans\/(\d+)(?:-[\w.-]*)?/g;

/** The plan numbers mentioned in `git show <rev>:plans/NN…` retrieval commands on a line. */
function hintedPlanNumbers(line) {
  return [...line.matchAll(/\bgit show \S+?:plans\/(\d+)/g)].map((match) => match[1]);
}

export function isExemptPath(path) {
  return EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Each dangling plan citation in `files` (`{ path, text }`, paths repo-relative).
 * `planExists(number)` answers whether `plans/<number>-*.md` is in the working tree.
 */
export function findDanglingPlanReferences({ files, planExists }) {
  const findings = [];
  for (const { path, text } of files) {
    if (isExemptPath(path)) continue;
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(PLAN_REFERENCE)) {
        const number = match[1];
        if (planExists(number)) continue;
        const window = lines.slice(Math.max(0, index - HINT_WINDOW), index + HINT_WINDOW + 1);
        if (window.some((nearby) => hintedPlanNumbers(nearby).includes(number))) continue;
        findings.push({ path, line: index + 1, reference: match[0] });
      }
    });
  }
  return findings;
}

/** Plan numbers present under `plans/`, keyed by the number before the first dash. */
export function presentPlanNumbers(plansDir = 'plans') {
  if (!existsSync(plansDir)) return new Set();
  return new Set(
    readdirSync(plansDir)
      .map((name) => /^(\d+)-/.exec(name)?.[1])
      .filter(Boolean),
  );
}

function main() {
  const present = presentPlanNumbers();
  const files = walkFiles(PERMANENT_ROOTS, { extensions: ['md'] }).map((filePath) => ({
    path: relative(process.cwd(), filePath),
    text: readTextFile(filePath),
  }));
  const findings = findDanglingPlanReferences({ files, planExists: (number) => present.has(number) });

  reportFindings({
    title: 'Plan reference check',
    emptyMessage: `Plan reference check OK (${files.length} permanent files scanned).`,
    findings: findings.map(({ path, line, reference }) => ({
      location: `${path}:${line}`,
      message:
        `\`${reference}\` is not in the tree and carries no \`git show <sha>^:plans/<file>.md\` hint nearby. `
        + 'Cite the permanent home of the content instead, or add the retrieval command '
        + '(rules/workflow-rules.md §0 *Document Lifecycle*, governing rule 2).',
    })),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
