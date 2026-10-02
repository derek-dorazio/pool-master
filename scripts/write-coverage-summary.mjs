// #294 — appends a coverage table to the GitHub step summary, one section per
// "<label>=<coverage-summary.json>" argument. A missing file renders as "not available"
// rather than failing: the summary is a convenience view, never a gate.
//
// node scripts/write-coverage-summary.mjs "<heading>" "<label>=<path>" [...]
import fs from 'node:fs';

const [heading, ...sections] = process.argv.slice(2);
const markdown = [`### ${heading}`];

for (const section of sections) {
  const separator = section.indexOf('=');
  const label = section.slice(0, separator);
  const filePath = section.slice(separator + 1);

  markdown.push('', `#### ${label}`, '');
  if (!fs.existsSync(filePath)) {
    console.log(`${label}: coverage data not available (${filePath})`);
    markdown.push('Coverage data not available');
    continue;
  }

  const t = JSON.parse(fs.readFileSync(filePath, 'utf8')).total;
  console.log(`${label}: statements ${t.statements.pct}%, branches ${t.branches.pct}%, functions ${t.functions.pct}%, lines ${t.lines.pct}%`);
  markdown.push(
    '| Metric | Coverage |',
    '|---|---:|',
    `| Statements | ${t.statements.pct}% |`,
    `| Branches | ${t.branches.pct}% |`,
    `| Functions | ${t.functions.pct}% |`,
    `| Lines | ${t.lines.pct}% |`,
  );
}

const out = process.env.GITHUB_STEP_SUMMARY;
if (out) {
  fs.appendFileSync(out, `${markdown.join('\n')}\n`);
}
