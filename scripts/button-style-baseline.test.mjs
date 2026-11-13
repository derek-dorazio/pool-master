import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';

import tseslintParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';

import { BUTTON_STYLE_BASELINE } from '../eslint-rules/button-style-baseline.mjs';
import poolmaster from '../eslint-rules/index.mjs';

describe('no-button-style-override baseline (#1615)', () => {
  it('lists only files that still exist and still restyle a button, so a clean file leaves the list', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [{
        files: ['**/*.tsx'],
        languageOptions: { parser: tseslintParser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { poolmaster },
        rules: { 'poolmaster/no-button-style-override': 'error' },
      }],
    });
    for (const file of BUTTON_STYLE_BASELINE) {
      assert.ok(existsSync(file), `${file} is listed but no longer exists; remove it from the baseline`);
      const [result] = await eslint.lintFiles([file]);
      const found = result.messages.filter((message) => message.ruleId === 'poolmaster/no-button-style-override');
      assert.ok(found.length > 0, `${file} no longer restyles a button; remove it from the baseline`);
    }
  });
});
