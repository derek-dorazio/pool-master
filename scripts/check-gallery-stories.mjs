/**
 * #1615 — every shared UI component has a gallery story.
 *
 * The component gallery (`npm run gallery -w @poolmaster/poolmaster`, Storybook) shows each
 * shared part in light and dark at phone and desktop widths, so a page under review is compared
 * with the pattern rather than with its own before. That only works if every part is in it:
 * each component file in `clients/poolmaster/src/features/shared/ui` (a `.tsx` that is not a test
 * or a story) needs a `<name>.stories.tsx` beside it, and a story file needs its component.
 * A `.ts` file there holds helpers, hooks or types, not a component, and needs no story.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SHARED_UI_DIR = 'clients/poolmaster/src/features/shared/ui';

const STORY = /\.stories\.tsx$/;
const TEST = /\.(test|spec)\.tsx?$/;

/** Component files with no story, and story files whose component is gone. */
export function findMissingStories(fileNames) {
  const names = new Set(fileNames);
  const components = fileNames.filter((name) => name.endsWith('.tsx') && !STORY.test(name) && !TEST.test(name));
  const stories = fileNames.filter((name) => STORY.test(name));
  return {
    withoutStory: components.filter((name) => !names.has(name.replace(/\.tsx$/, '.stories.tsx'))).sort(),
    orphanStories: stories.filter((name) => !names.has(name.replace(STORY, '.tsx'))).sort(),
  };
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const fileNames = readdirSync(join(repoRoot, SHARED_UI_DIR));
  const { withoutStory, orphanStories } = findMissingStories(fileNames);
  for (const name of withoutStory) {
    console.error(`${SHARED_UI_DIR}/${name} has no gallery story. Add ${name.replace(/\.tsx$/, '.stories.tsx')} beside it (rules/react-ui-rules.md, Component gallery).`);
  }
  for (const name of orphanStories) {
    console.error(`${SHARED_UI_DIR}/${name} has no component beside it. Delete it with the component, or rename it with the component.`);
  }
  if (withoutStory.length > 0 || orphanStories.length > 0) process.exit(1);
  console.log(`Every shared UI component has a gallery story (${fileNames.filter((n) => STORY.test(n)).length} story files).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
