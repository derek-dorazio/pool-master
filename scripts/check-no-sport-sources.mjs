/**
 * Fails when sport-sources/ is in the tree. The "Fetch sport sources" workflow commits
 * third-party page text there for an agent writing a test data file to read on its branch; it
 * deletes it before the data file is merged, and this check makes sure it did.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;
const folder = join(repoRoot, 'sport-sources');

if (existsSync(folder)) {
  console.error('sport-sources/ is in the tree. It holds fetched source pages for writing test data files and never reaches main: delete it before merging.');
  process.exit(1);
}
console.log('No fetched sport sources in the tree.');
