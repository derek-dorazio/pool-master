import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import tseslintParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';

import poolmaster from '../eslint-rules/index.mjs';

const BASELINES = {
  'poolmaster/no-enum-string-literals': 'enum-string-literal-baseline.json',
  'poolmaster/no-dto-shaped-local-types': 'dto-shape-baseline.json',
  'poolmaster/no-local-enums': 'local-enum-baseline.json',
};

const read = (name) => Object.entries(JSON.parse(readFileSync(new URL(`../eslint-rules/${name}`, import.meta.url), 'utf8')))
  .filter(([key]) => !key.startsWith('$'));

describe('web contract lint baselines (#2107)', () => {
  it('counts exactly the hits each listed file still has for each rule, so a cleaned-up hit lowers its entry', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [{
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: tseslintParser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { poolmaster },
        rules: Object.fromEntries(Object.keys(BASELINES).map((rule) => [rule, 'error'])),
      }],
    });
    const listed = Object.entries(BASELINES).flatMap(([rule, name]) => read(name).map(([file, count]) => ({ rule, name, file, count })));
    const files = [...new Set(listed.map(({ file }) => file))];
    for (const file of files) assert.ok(existsSync(file), `${file} is listed in a web contract baseline but no longer exists; remove it`);
    const results = new Map((await eslint.lintFiles(files)).map((result) => [result.filePath.slice(process.cwd().length + 1), result]));
    for (const { rule, name, file, count } of listed) {
      const found = results.get(file).messages.filter((message) => message.ruleId === rule).length;
      assert.equal(found, count, `${file} has ${found} ${rule} hits and eslint-rules/${name} lists ${count}; lower its entry (delete it at 0)`);
    }
  });
});
