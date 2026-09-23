/**
 * Skills may point at rules, and at nothing else that can disappear.
 *
 * A skill outlives the work that produced it. Anything it cites must outlive it
 * too, or the skill becomes a set of instructions pointing at files that are no
 * longer there -- worse than no pointer, because it reads as authoritative.
 *
 * Transient by design in this repo:
 *   - GitHub issues        close, and a closed issue explains nothing to a reader
 *   - plans/NN-*.md        deleted when the parent epic closes (ADR-0002)
 *   - tech-specs paths     deleted when the implementation ships (ADR-0003)
 *   - requirements feature dirs  retired when the feature stabilizes
 *   - personas/*.md        being retired entirely
 *   - docs/adr/*.md        permanent, but a decision's rationale is not a
 *                          work instruction; put the instruction in a rule and
 *                          let the rule carry the ADR link
 *   - source line numbers  drift on the next edit above them
 *
 * The durable target is `rules/<file>.md §N *Section Name*`. The section name
 * matters: numbers get renumbered, and a number alone then points confidently at
 * the wrong section.
 *
 * Fenced code blocks are exempt so a skill can demonstrate a format -- a commit
 * message, a test name, a SKIP marker -- without the placeholder being read as a
 * live pointer.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;
const skillRoot = join(repoRoot, '.claude/skills');

const forbidden = [
  { label: 'GitHub issue reference', pattern: /(?<![\w/#])#\d{2,5}\b/g },
  { label: 'specific plan file', pattern: /\bplans\/\d+[\w-]*/g },
  { label: 'persona file', pattern: /\bpersonas\/[\w-]+\.md/g },
  { label: 'tech-spec path', pattern: /\btech-specs\/[\w/-]+/g },
  { label: 'specific requirements file', pattern: /\brequirements\/[\w-]+\/[\w./-]+/g },
  { label: 'ADR reference', pattern: /\bADR-\d{3,4}\b|\bdocs\/adr\/[\w.-]+/g },
  { label: 'legacy tracker id', pattern: /\bpool-master-[a-z0-9]{3}[.\d]*/g },
  { label: 'source line number', pattern: /\b[\w/.-]+\.(?:ts|tsx|mjs|js):\d+/g },
];

function collectSkillFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? collectSkillFiles(path)
      : (entry === 'SKILL.md' ? [path] : []);
  });
}

const violations = [];

for (const file of collectSkillFiles(skillRoot)) {
  const relativePath = relative(repoRoot, file);
  let inFence = false;

  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    for (const { label, pattern } of forbidden) {
      const matches = line.match(pattern);
      if (matches) {
        violations.push({ path: relativePath, line: index + 1, label, matches });
      }
    }
  });
}

if (violations.length > 0) {
  console.error('Skills must not point at anything that can disappear.\n');
  console.error('Cite `rules/<file>.md §N *Section Name*` instead, or state the content directly.');
  console.error('See the header of scripts/check-skill-references.mjs for why each kind is banned.\n');

  for (const v of violations) {
    console.error(`${v.path}:${v.line} ${v.label} — ${v.matches.join(', ')}`);
  }

  process.exit(1);
}

console.log('Skill reference check passed.');
