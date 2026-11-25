import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import tseslintParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';

import poolmaster from '../eslint-rules/index.mjs';

const RULE = 'poolmaster/no-name-match';
const BASELINE = Object.entries(JSON.parse(readFileSync(new URL('../eslint-rules/name-match-baseline.json', import.meta.url), 'utf8')))
  .filter(([key]) => !key.startsWith('$'));

describe('no-name-match baseline (#2114)', () => {
  it('counts exactly the name lookups each listed file still has, so a cleaned-up lookup lowers its entry', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [{
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: tseslintParser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { poolmaster },
        rules: { [RULE]: 'error' },
      }],
    });
    for (const [file] of BASELINE) assert.ok(existsSync(file), `${file} is listed but no longer exists; remove it from the baseline`);
    const results = new Map((await eslint.lintFiles(BASELINE.map(([file]) => file))).map((result) => [result.filePath.slice(process.cwd().length + 1), result]));
    for (const [file, count] of BASELINE) {
      const found = results.get(file).messages.filter((message) => message.ruleId === RULE).length;
      assert.equal(found, count, `${file} has ${found} name lookups and eslint-rules/name-match-baseline.json lists ${count}; lower its entry (delete it at 0)`);
    }
  });
});
