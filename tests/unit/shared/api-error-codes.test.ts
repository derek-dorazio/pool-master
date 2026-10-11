/**
 * The API's error-code list (#594) is what the web keys its error copy by. The server's error
 * classes and `sendError` take only listed codes, so typecheck catches a code sent but not
 * listed. These catch the other direction: a listed code nothing sends any more, which would let
 * stale copy for it pass typecheck.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@jest/globals';
import { API_ERROR_CODES, isApiErrorCode } from '../../../packages/shared/dto/api-error-codes';

const repoRoot = path.resolve(__dirname, '../../..');
const LIST_FILE = path.join(repoRoot, 'packages/shared/dto/api-error-codes.ts');
const SOURCE_ROOTS = ['packages/core-api/src', 'packages/shared/dto', 'packages/shared/domain'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') && full !== LIST_FILE ? [full] : [];
  });
}

describe('API error-code list', () => {
  it('lists only codes the server source still sends', () => {
    const source = SOURCE_ROOTS
      .flatMap((root) => sourceFiles(path.join(repoRoot, root)))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    const unused = API_ERROR_CODES.filter((code) => !source.includes(`'${code}'`));

    expect(unused).toEqual([]);
  });

  it('lists each code once, in alphabetical order so additions are easy to review', () => {
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
    expect([...API_ERROR_CODES]).toEqual([...API_ERROR_CODES].sort());
  });

  it('recognizes a listed code and refuses one the API does not send', () => {
    expect(isApiErrorCode('CONTEST_NOT_FOUND')).toBe(true);
    expect(isApiErrorCode('FST_ERR_CTP_INVALID_MEDIA_TYPE')).toBe(false);
  });
});
