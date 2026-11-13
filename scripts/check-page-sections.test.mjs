import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countSectionCards, isPageFile, pagesOverOneSection } from './check-page-sections.mjs';

describe('check-page-sections (#1615)', () => {
  it('reads web app page files only, not sections, shared parts or tests', () => {
    assert.equal(isPageFile('clients/poolmaster/src/features/account/my-account-page.tsx'), true);
    assert.equal(isPageFile('clients/poolmaster/src/features/account/my-account-profile-section.tsx'), false);
    assert.equal(isPageFile('clients/poolmaster/src/features/shared/ui/status-page.tsx'), false);
    assert.equal(isPageFile('clients/poolmaster/src/features/account/my-account-page.test.tsx'), false);
  });

  it('counts each SectionCard a page renders itself, open or self-closing', () => {
    const page = '<div><SectionCard title="A"><p /></SectionCard><SectionCard title="B" /><ProfileSection /></div>';
    assert.equal(countSectionCards(page), 2);
  });

  it('counts a section a page imports as one of its own files as none', () => {
    assert.equal(countSectionCards('<div><ProfileSection /><SecuritySection /></div>'), 0);
  });

  it('lists only the pages over one section, so a page with one section never appears', () => {
    const counts = pagesOverOneSection([
      ['a-page.tsx', '<SectionCard title="A" />'],
      ['b-page.tsx', '<><SectionCard title="A" /><SectionCard title="B" /><SectionCard title="C" /></>'],
    ]);
    assert.deepEqual(counts, { 'b-page.tsx': 3 });
  });
});
