import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runRuleScript(scriptName: string, cwd: string) {
  const repoRoot = join(__dirname, '../../..');
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', scriptName)], {
    cwd,
    encoding: 'utf8',
  });
}

function withTempRepo(callback: (tempRoot: string) => void) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'poolmaster-rule-scanner-'));

  try {
    callback(tempRoot);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

describe('pool-master-q8h: frontend rule scanner scripts', () => {
  it('pool-master-q8h: no-inline-theme-styles flags literal inline theme values only', () => {
    withTempRepo((tempRoot) => {
      const featureDir = join(tempRoot, 'clients/poolmaster/src/features/demo');
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(
        join(featureDir, 'theme-violation.tsx'),
        [
          'export function Demo() {',
          '  return <div style={{ color: "#fff", gap: 8, transform: `translateX(${1}px)` }} />;',
          '}',
          '',
        ].join('\n'),
      );

      const result = runRuleScript('check-no-inline-theme-styles.mjs', tempRoot);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('theme-violation.tsx:2');
      expect(result.stdout).toContain('Inline theme style "color"');
      expect(result.stdout).not.toContain('gap');
      expect(result.stdout).not.toContain('transform');
    });
  });

  it('pool-master-q8h: no-inline-theme-styles passes dynamic non-theme styles', () => {
    withTempRepo((tempRoot) => {
      const featureDir = join(tempRoot, 'clients/poolmaster/src/features/demo');
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(
        join(featureDir, 'theme-pass.tsx'),
        [
          'export function Demo({ x }: { x: number }) {',
          '  return <div style={{ gap: 8, transform: `translateX(${x}px)` }} />;',
          '}',
          '',
        ].join('\n'),
      );

      const result = runRuleScript('check-no-inline-theme-styles.mjs', tempRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('No inline theme styles found.');
    });
  });

  // The two `no-non-sdk-fetch` cases that lived here were removed with the scanner
  // itself (#134): that rule is now `no-restricted-globals` / `no-restricted-imports`
  // in eslint.config.js. They are not replaced in kind -- the ESLint rule is scoped by
  // a `clients/poolmaster/src/**` path glob, so a temp-directory fixture never matches
  // it, and testing it would need fixture files inside the real linted tree. The
  // migration was verified by planting a violation in place and confirming the scanner
  // and the ESLint rule flagged identical lines.

  it('pool-master-q8h: no-parallel-api-types flags local duplicates of generated types', () => {
    withTempRepo((tempRoot) => {
      const generatedDir = join(tempRoot, 'packages/shared/generated/hey-api');
      const featureDir = join(tempRoot, 'clients/poolmaster/src/features/demo');
      mkdirSync(generatedDir, { recursive: true });
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(
        join(generatedDir, 'types.gen.ts'),
        'export type LeagueResponse = { id: string };\n',
      );
      writeFileSync(
        join(featureDir, 'parallel-type.ts'),
        'export interface LeagueResponse { id: string }\n',
      );

      const result = runRuleScript('check-no-parallel-api-types.mjs', tempRoot);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('parallel-type.ts:1');
      expect(result.stdout).toContain('LeagueResponse');
    });
  });

  it('pool-master-q8h: no-parallel-api-types passes non-duplicated local types', () => {
    withTempRepo((tempRoot) => {
      const generatedDir = join(tempRoot, 'packages/shared/generated/hey-api');
      const featureDir = join(tempRoot, 'clients/poolmaster/src/features/demo');
      mkdirSync(generatedDir, { recursive: true });
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(
        join(generatedDir, 'types.gen.ts'),
        'export type LeagueResponse = { id: string };\n',
      );
      writeFileSync(
        join(featureDir, 'local-type.ts'),
        'export interface LocalViewModel { id: string }\n',
      );

      const result = runRuleScript('check-no-parallel-api-types.mjs', tempRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'No frontend types duplicate generated hey-api names.',
      );
    });
  });
});
