#!/usr/bin/env npx tsx
/**
 * Validate OpenAPI spec quality for priority routes.
 *
 * Checks that routes consumed by web/admin clients have:
 *   - operationId
 *   - summary
 *   - tags
 *   - At least one response with application/json content
 *
 * Usage: npx tsx scripts/validate-openapi-spec.ts
 * Exit code: 1 if any priority route is missing required fields
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface OpenAPISpec {
  paths: Record<string, Record<string, {
    operationId?: string;
    summary?: string;
    tags?: string[];
    responses?: Record<string, {
      content?: Record<string, unknown>;
    }>;
  }>>;
}

// Routes consumed by clients/web and clients/admin that MUST have complete schemas.
// Add routes here as they are wired to DTO-backed schemas.
const PRIORITY_ROUTE_PREFIXES = [
  '/api/v1/auth/',
  '/api/v1/leagues/',
  '/api/v1/contests/',
  '/api/v1/drafts/',
  '/api/v1/billing/',
  '/api/v1/notifications/',
  '/api/v1/standings/',
  '/api/v1/participants/',
  '/api/v1/search/',
  '/api/v1/templates/',
  '/api/v1/scoring/',
  '/api/v1/config/',
  '/api/v1/admin/',
  '/api/v1/social/',
  '/api/v1/invitations/',
  '/api/v1/devices/',
];

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;

function isPriorityRoute(path: string): boolean {
  return PRIORITY_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function hasJsonResponse(responses: Record<string, { content?: Record<string, unknown> }> | undefined): boolean {
  if (!responses) return false;
  return Object.values(responses).some(
    (resp) => resp.content && 'application/json' in resp.content,
  );
}

function main() {
  const specPath = resolve(__dirname, '../packages/shared/generated/openapi.json');
  const raw = readFileSync(specPath, 'utf-8');
  const spec: OpenAPISpec = JSON.parse(raw);

  const issues: string[] = [];
  let checkedCount = 0;
  let passCount = 0;

  for (const [path, methods] of Object.entries(spec.paths).sort()) {
    if (!isPriorityRoute(path)) continue;

    for (const method of HTTP_METHODS) {
      const operation = methods[method];
      if (!operation) continue;
      checkedCount++;

      const missing: string[] = [];
      if (!operation.operationId) missing.push('operationId');
      if (!operation.summary) missing.push('summary');
      if (!operation.tags?.length) missing.push('tags');
      if (!hasJsonResponse(operation.responses)) missing.push('JSON response content');

      if (missing.length > 0) {
        issues.push(`  ${method.toUpperCase().padEnd(6)} ${path}\n         missing: ${missing.join(', ')}`);
      } else {
        passCount++;
      }
    }
  }

  console.log(`OpenAPI spec quality check`);
  console.log(`  Checked: ${checkedCount} priority operations`);
  console.log(`  Passing: ${passCount}`);
  console.log(`  Failing: ${issues.length}`);

  if (issues.length > 0) {
    console.log(`\nIssues:\n${issues.join('\n')}`);
    process.exit(1);
  } else {
    console.log('\nAll priority routes have complete OpenAPI schemas.');
  }
}

main();
