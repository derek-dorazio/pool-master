import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';

import tseslintParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';

import poolmaster from '../eslint-rules/index.mjs';
import { QUERY_STATES_BASELINE } from '../eslint-rules/query-states-baseline.mjs';

describe('no-hand-written-query-states baseline (#1588)', () => {
  it('grandfathers root admin files only, never a member page', () => {
    for (const file of QUERY_STATES_BASELINE) {
      assert.match(file, /^clients\/poolmaster\/src\/features\/root-admin\//, file);
    }
  });

  it('lists only files that still exist and still draw a state by hand, so a clean file leaves the list', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [{
        files: ['**/*.tsx'],
        languageOptions: { parser: tseslintParser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { poolmaster },
        rules: { 'poolmaster/no-hand-written-query-states': 'error' },
      }],
    });
    for (const file of QUERY_STATES_BASELINE) {
      assert.ok(existsSync(file), `${file} is listed but no longer exists; remove it from the baseline`);
      const [result] = await eslint.lintFiles([file]);
      const found = result.messages.filter((message) => message.ruleId === 'poolmaster/no-hand-written-query-states');
      assert.ok(found.length > 0, `${file} no longer draws a state by hand; remove it from the baseline`);
    }
  });
});
