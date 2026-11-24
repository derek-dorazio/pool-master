import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import tseslintParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';

import poolmaster from '../eslint-rules/index.mjs';

const BASELINE = Object.entries(JSON.parse(readFileSync(new URL('../eslint-rules/clock-year-baseline.json', import.meta.url), 'utf8')))
  .filter(([key]) => !key.startsWith('$'));

describe('no-clock-year-or-league-tables baseline (#1927)', () => {
  it('counts exactly the hits each listed file still has, so a cleaned-up hit lowers its entry', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [{
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: tseslintParser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { poolmaster },
        rules: { 'poolmaster/no-clock-year-or-league-tables': 'error' },
      }],
    });
    for (const [file, count] of BASELINE) {
      assert.ok(existsSync(file), `${file} is listed but no longer exists; remove it from the baseline`);
      const [result] = await eslint.lintFiles([file]);
      const found = result.messages.filter((message) => message.ruleId === 'poolmaster/no-clock-year-or-league-tables').length;
      assert.equal(found, count, `${file} has ${found} clock-year or league-table hits and the baseline lists ${count}; lower its entry (delete it at 0)`);
    }
  });
});
