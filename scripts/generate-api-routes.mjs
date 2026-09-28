/**
 * Generates `packages/shared/api-routes.ts` from the committed OpenAPI spec (#212).
 *
 * The table used to be written by hand, above a comment calling itself "the single source of
 * truth". It was not: the Fastify registrations are, and `openapi.json` is generated from them.
 * The copy drifted exactly as that arrangement predicts — ten entries had lost the trailing slash
 * the spec carries, and four pointed at routes that no longer exist.
 *
 * What stays hand-written is the *manifest* below: which operation each name means. That cannot
 * go stale silently, because an operationId the spec does not contain fails this generator, and
 * the generator runs in `npm run api:refresh` and is verified by `npm run api:check` in CI.
 *
 * Why generate a committed file rather than read the spec at runtime, as
 * `clients/poolmaster/src/test/msw-api.ts` does: `api-routes.ts` has a production consumer.
 * `clients/poolmaster/src/lib/logger/network-sink.ts` takes its endpoint from it, so parsing the
 * 1.8 MB spec at module load would put the whole spec in the webapp bundle.
 *
 *   node scripts/generate-api-routes.mjs           # write the file
 *   node scripts/generate-api-routes.mjs --check   # fail if the file is out of date
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SPEC_PATH = resolve('packages/shared/generated/openapi.json');
const OUTPUT_PATH = resolve('packages/shared/api-routes.ts');

/**
 * name -> operationId, or `{ literal }` for a path the spec does not describe.
 *
 * Several names share a path deliberately: `leagues.list` and `leagues.create` are the same URL
 * with different methods, and callers read better naming the intent. Any operation on a path
 * yields that path, so which one a name points at only has to be true, not unique.
 */
const MANIFEST = {
  auth: {
    $comment: 'Auth',
    login: 'loginUser',
    register: 'registerUser',
    refresh: 'refreshToken',
    logout: 'logoutUser',
  },
  users: {
    $comment: [
      'Users — #202 step 3.4. One operation set. `me` resolves to the authenticated caller, so',
      'these paths serve both a user acting on themselves and a root admin acting on somebody;',
      'access rule A6 decides which is allowed. They replaced `/api/v1/auth/me`,',
      '`/api/v1/account/*` and `/api/v1/admin/users/*`.',
    ],
    list: 'listUsers',
    detail: 'getUser',
    profile: 'updateUserProfile',
    username: 'updateUserUsername',
    preferences: 'updateUserPreferences',
    password: 'changeUserPassword',
    resetPassword: 'resetUserPassword',
    disable: 'disableUser',
    enable: 'enableUser',
    revokeSessions: 'revokeUserSessions',
    rootAdmin: 'setUserRootAdmin',
  },
  leagues: {
    $comment: 'Leagues',
    list: 'listLeagues',
    create: 'createLeague',
    detail: 'getLeague',
    details: 'updateLeagueDetails',
    icon: 'updateLeagueIcon',
    inactivate: 'inactivateLeague',
    activate: 'activateLeague',
    byCode: 'getLeagueByCode',
    members: 'listLeagueMembers',
    leave: 'leaveLeague',
    memberRole: 'changeMemberRole',
    removeMember: 'removeMember',
    inviteLink: 'generateInviteLink',
    contests: 'listContests',
    squads: 'listLeagueSquads',
    contestManagement: 'createManagedContest',
  },
  squads: {
    list: 'listLeagueSquads',
    create: 'createLeagueSquad',
    detail: 'getLeagueSquad',
    inactivate: 'inactivateLeagueSquad',
    ownerInvitations: 'listSquadOwnerInvitations',
    createOwnerInvitation: 'createSquadOwnerInvitation',
    replaceOwner: 'replaceSquadOwner',
    revokeOwnerInvitation: 'revokeSquadOwnerInvitation',
    addMember: 'addSquadOwner',
    removeMember: 'removeSquadOwner',
  },
  invitations: {
    $comment: 'Invitations',
    preview: 'getInvitationPreview',
    accept: 'acceptInvitation',
  },
  teamInvitations: {
    preview: 'getTeamOwnerInvitationPreview',
    accept: 'acceptTeamOwnerInvitation',
  },
  contests: {
    $comment: 'Contests',
    detail: 'getContest',
    entries: 'listContestEntries',
    myEntry: 'getMyContestEntry',
  },
  contestManagement: {
    templates: 'listManagedContestTemplates',
    detail: 'getManagedContest',
    configuration: 'updateManagedContestConfiguration',
  },
  drafts: {
    $comment: 'Drafts',
    start: 'startDraft',
    state: 'getDraftState',
    pick: 'submitContestSelection',
  },
  observability: {
    clientLogs: 'ingestClientLogs',
  },
};

/** Top-level entries, emitted after the sections. */
const TOP_LEVEL = {
  // The container health probe. It is not an API operation and is deliberately absent from the
  // spec, so it is the one path here that stays a literal.
  health: { literal: '/health' },
  version: 'getVersion',
  rootVersion: 'getRootVersion',
};

function loadPathsByOperationId() {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  const paths = new Map();

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!['delete', 'get', 'patch', 'post', 'put'].includes(method)) continue;
      const operationId = operation?.operationId;
      if (!operationId) continue;
      if (!paths.has(operationId)) paths.set(operationId, path);
    }
  }

  return paths;
}

/** `/api/v1/leagues/{id}/squads/{squadId}` -> `['id', 'squadId']`. */
function pathParams(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function renderEntry(name, value, pathsByOperationId, indent) {
  if (typeof value === 'object' && value.literal) {
    return `${indent}${name}: '${value.literal}',`;
  }

  const path = pathsByOperationId.get(value);
  if (!path) {
    throw new Error(
      `api-routes manifest names operation '${value}' for '${name}', which the OpenAPI spec does not contain. ` +
        'Either the route was renamed or removed — update the manifest in scripts/generate-api-routes.mjs.',
    );
  }

  const params = pathParams(path);
  if (params.length === 0) {
    return `${indent}${name}: '${path}',`;
  }

  const signature = params.map((param) => `${param}: string`).join(', ');
  const template = path.replaceAll(/\{([^}]+)\}/g, '${$1}');
  const line = `${indent}${name}: (${signature}) => \`${template}\`,`;
  if (line.length <= 100) return line;

  return `${indent}${name}: (${signature}) =>\n${indent}  \`${template}\`,`;
}

function renderComment(comment, indent) {
  const lines = Array.isArray(comment) ? comment : [comment];
  return lines.map((line) => `${indent}// ${line}`).join('\n');
}

function generate() {
  const pathsByOperationId = loadPathsByOperationId();
  const out = [];

  out.push(`/**
 * Canonical API route paths.
 *
 * **Generated from \`packages/shared/generated/openapi.json\` — do not edit by hand.**
 * Run \`npm run api:refresh\` to regenerate; \`npm run api:check\` fails in CI when this file and
 * the spec disagree. The mapping from each name to its operation lives in
 * \`scripts/generate-api-routes.mjs\`.
 *
 * Used by:
 *   - Integration and contract-focused test suites, which build \`inject()\` URLs
 *   - \`clients/poolmaster/src/lib/logger/network-sink.ts\`, the one production consumer: the log
 *     transport cannot go through the generated SDK, because it is what reports the failures the
 *     SDK would be producing
 *
 * Everything else should use the generated SDK rather than a literal path (#212).
 */
`);

  out.push('export const API_ROUTES = {');

  const sectionNames = Object.keys(MANIFEST);
  sectionNames.forEach((section, index) => {
    const entries = MANIFEST[section];
    if (entries.$comment) out.push(renderComment(entries.$comment, '  '));
    out.push(`  ${section}: {`);
    for (const [name, value] of Object.entries(entries)) {
      if (name === '$comment') continue;
      out.push(renderEntry(name, value, pathsByOperationId, '    '));
    }
    out.push('  },');
    if (index < sectionNames.length - 1) out.push('');
  });

  out.push('');
  for (const [name, value] of Object.entries(TOP_LEVEL)) {
    out.push(renderEntry(name, value, pathsByOperationId, '  '));
  }

  out.push('} as const;');
  out.push('');

  return out.join('\n');
}

const generated = generate();

if (process.argv.includes('--check')) {
  const current = readFileSync(OUTPUT_PATH, 'utf8');
  if (current !== generated) {
    console.error(
      'packages/shared/api-routes.ts is out of date with the OpenAPI spec.\n' +
        'Run `npm run api:refresh` (or `node scripts/generate-api-routes.mjs`) and commit the result.',
    );
    process.exit(1);
  }
  console.log('api-routes.ts is up to date with the OpenAPI spec.');
} else {
  writeFileSync(OUTPUT_PATH, generated);
  console.log(`Wrote ${OUTPUT_PATH}`);
}
