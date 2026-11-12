import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findMissingStories } from './check-gallery-stories.mjs';

describe('check-gallery-stories (#1615)', () => {
  it('passes when every component file has a story beside it', () => {
    assert.deepEqual(
      findMissingStories(['button.tsx', 'button.stories.tsx', 'button.test.tsx', 'class-names.ts']),
      { withoutStory: [], orphanStories: [] },
    );
  });

  it('reports a component file that has no story', () => {
    assert.deepEqual(
      findMissingStories(['button.tsx', 'button.stories.tsx', 'notice.tsx', 'notice.test.tsx']).withoutStory,
      ['notice.tsx'],
    );
  });

  it('reports a story left behind when its component is deleted', () => {
    assert.deepEqual(findMissingStories(['action-list.stories.tsx']).orphanStories, ['action-list.stories.tsx']);
  });

  it('asks no story of helper, hook or type modules (.ts) or of tests', () => {
    assert.deepEqual(
      findMissingStories(['scroll-row.ts', 'popover-timing.ts', 'modal.test.tsx', 'README.md']),
      { withoutStory: [], orphanStories: [] },
    );
  });
});
