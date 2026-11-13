/**
 * #1615 — one file per section (rules/react-ui-rules.md *Page Decomposition Threshold*). A page
 * with more than one titled section is a folder: `<page>-page.tsx` does loading and layout, and
 * each section is its own `<page>-<section>-section.tsx`, owning its data call, actions, Edit
 * dialog and tests. The section is the unit that ports to React Native.
 *
 * This check counts the `SectionCard`s each page file (`*-page.tsx` in web app source outside
 * `features/shared/ui`) renders itself and lists those with more than one, against
 * `scripts/page-sections-baseline.json`: the big pages still waiting to be split. Like the
 * text-style check it fails both ways: a page over its entry (or a new page with two sections)
 * has sections to move into their own files, and a page under it has been split, so its entry
 * comes down in the same PR. `--update` only lowers entries and drops those at one or none.
 * Tests are exempt.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compareWithBaseline, isCheckedSource, ratchetBaseline } from './check-text-styles.mjs';

export const BASELINE_FILE = 'scripts/page-sections-baseline.json';
const PAGE_FILE = /-page\.tsx$/;

/** Whether a web source path is a page file this check reads. */
export function isPageFile(path) {
  return PAGE_FILE.test(path) && isCheckedSource(path);
}

/** How many `SectionCard`s a source file renders itself. */
export function countSectionCards(text, fileName = 'page.tsx') {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const walk = (node) => {
    const tag = ts.isJsxElement(node)
      ? node.openingElement.tagName.getText(source)
      : ts.isJsxSelfClosingElement(node) ? node.tagName.getText(source) : null;
    if (tag === 'SectionCard') count += 1;
    ts.forEachChild(node, walk);
  };
  walk(source);
  return count;
}

/** The pages over one section, with their counts: what the baseline compares. */
export function pagesOverOneSection(files) {
  const counts = {};
  for (const [path, text] of files) {
    const count = countSectionCards(text, path);
    if (count > 1) counts[path] = count;
  }
  return counts;
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const listed = spawnSync('git', ['ls-files', 'clients/poolmaster/src'], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) {
    console.error(listed.stderr);
    process.exit(1);
  }
  const pages = listed.stdout.split('\n').filter((entry) => entry && isPageFile(entry));
  const counts = pagesOverOneSection(pages.map((path) => [path, readFileSync(join(repoRoot, path), 'utf8')]));
  const baseline = JSON.parse(readFileSync(join(repoRoot, BASELINE_FILE), 'utf8'));
  const update = process.argv.includes('--update');
  if (update) {
    const lowered = ratchetBaseline(counts, baseline);
    writeFileSync(join(repoRoot, BASELINE_FILE), `${JSON.stringify(lowered, null, 2)}\n`);
    console.log(`Lowered ${BASELINE_FILE}: ${Object.keys(lowered).length} files.`);
  }
  const { over, under } = compareWithBaseline(counts, update ? ratchetBaseline(counts, baseline) : baseline);
  for (const { path, count, allowed } of over) {
    console.error(`${path} renders ${count} SectionCards (baseline ${allowed}). Each section is its own <page>-<section>-section.tsx (rules/react-ui-rules.md, Page Decomposition Threshold).`);
  }
  for (const { path, count, allowed } of under) {
    console.error(`${path} now renders ${count > 1 ? count : 'one or no'} SectionCard(s) itself (baseline ${allowed}). Lower its entry: run node scripts/check-page-sections.mjs --update.`);
  }
  if (over.length > 0 || under.length > 0) process.exit(1);
  console.log(`Page sections match the baseline: ${Object.keys(counts).length} pages still render more than one section themselves.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
