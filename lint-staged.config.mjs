// Pre-commit lint on staged files only (#526). Full type-aware lint is too slow for a
// hook; CI still runs `npm run lint` over everything, and typecheck stays out of the
// hook entirely.
//
// The globs are the `lint` script's own scope in package.json. Keep them in step with
// it: a file staged outside them is not linted here and would not be linted in CI
// either.
//
// `--no-warn-ignored`: lint-staged passes file names explicitly, and ESLint warns on
// an explicitly named file that `eslint.config.js` ignores (generated code, `*.d.ts`).
// Under `--max-warnings 0` that warning would fail the commit.
const eslint = 'eslint --max-warnings 0 --no-warn-ignored';

export default {
  '{packages/**/*.ts,tests/**/*.{ts,tsx},clients/poolmaster/src/**/*.{ts,tsx},clients/poolmaster/*.config.ts}': eslint,
};
