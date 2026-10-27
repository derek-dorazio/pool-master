import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findBrandLiterals, isCheckedSource, readBrandStrings } from './check-brand-copy.mjs';

const brandSource = `
export const PRODUCT_NAME = 'Acme Pools';
export const PRODUCT_TAGLINE = 'Pools for everyone';
`;
const brandStrings = ['Acme Pools', 'Pools for everyone'];

describe('check-brand-copy (#1119)', () => {
  it('reads the name and tagline from brand.ts', () => {
    assert.deepEqual(readBrandStrings(brandSource), brandStrings);
  });

  it('throws when brand.ts no longer declares the tagline, rather than passing with nothing to look for', () => {
    assert.throws(() => readBrandStrings(`export const PRODUCT_NAME = 'Acme Pools';`), /PRODUCT_TAGLINE/);
  });

  it('reads app, API, script and HTML source but skips brand.ts, tests and markdown', () => {
    assert.equal(isCheckedSource('clients/poolmaster/src/features/app-shell/app-shell.tsx'), true);
    assert.equal(isCheckedSource('packages/core-api/src/modules/email/system-email-templates.ts'), true);
    assert.equal(isCheckedSource('clients/poolmaster/index.html'), true);
    assert.equal(isCheckedSource('clients/poolmaster/scripts/render-link-preview-images.mjs'), true);
    assert.equal(isCheckedSource('packages/shared/domain/brand.ts'), false);
    assert.equal(isCheckedSource('clients/poolmaster/src/features/app-shell/app-shell.test.tsx'), false);
    assert.equal(isCheckedSource('tests/unit/core-api/system-email-templates.test.ts'), false);
    assert.equal(isCheckedSource('clients/poolmaster/e2e/password-recovery.e2e.ts'), false);
    assert.equal(isCheckedSource('rules/ux-rules.md'), false);
  });

  it('fails a typed-out name or tagline, naming the file and line', () => {
    const files = [
      { path: 'a.tsx', text: `const title = PRODUCT_NAME;\n<h1>Acme Pools</h1>` },
      { path: 'b.ts', text: `subject: 'Pools for everyone'` },
    ];
    assert.deepEqual(findBrandLiterals({ files, brandStrings }), [
      { location: 'a.tsx:2', brand: 'Acme Pools' },
      { location: 'b.ts:1', brand: 'Pools for everyone' },
    ]);
  });

  it('passes source that reads the constants', () => {
    const files = [{ path: 'a.tsx', text: `<h1>{PRODUCT_NAME}</h1>\n<p>{PRODUCT_TAGLINE}</p>` }];
    assert.deepEqual(findBrandLiterals({ files, brandStrings }), []);
  });
});
