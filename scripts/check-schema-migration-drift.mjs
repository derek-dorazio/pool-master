/**
 * #340 — `schema.prisma` must describe what the committed migrations actually build.
 *
 * This repo treats `schema.prisma` as the description of the deployed database. Nothing enforced
 * that. Applying the migration history to an empty database and diffing the result against the
 * schema reported 7 altered columns across 5 tables, and CI never looked: the schema declared
 * `@default(uuid())` (generated application-side, so NO database default) on columns the history
 * had given `DEFAULT gen_random_uuid()`, and declared unbounded `String` for two columns the
 * history had built as `varchar(255)`.
 *
 * Nothing was broken by that — the database was stricter than the schema claimed. It becomes a
 * hazard the moment anyone generates a migration FROM the schema, which is exactly what a history
 * squash does: a schema-derived genesis migration would produce `text` columns with no defaults,
 * silently dropping both the length limits and the defaults.
 *
 * HOW IT CHECKS. Build the database the way production does — an empty database plus
 * `migrate deploy` — then ask Prisma to diff that against the schema. A non-empty diff means the
 * two artifacts disagree. All 80-odd migrations apply in about 3 seconds, so this is cheap enough
 * to run on every change.
 *
 * WHY A SCRATCH DATABASE AND NOT A SHADOW ONE. `prisma migrate diff --from-migrations` wants a
 * shadow database, and `migrate dev` / `migrate reset` are refused outright when Prisma detects an
 * agent. `--from-url` against a database this script creates itself avoids both, and it is also
 * the command that generates the reconciling migration when the check fails — the gate and the fix
 * are the same tool.
 *
 * The scratch database is created and dropped by this script. It is never the database named in
 * `DATABASE_URL`: that one holds the integration suite's data, and this check would destroy it.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SCHEMA_PATH = 'packages/core-api/prisma/schema.prisma';

/** The database this check builds from scratch. Deliberately not a name anything else uses. */
export const SCRATCH_DATABASE = 'poolmaster_schema_drift_check';

/**
 * The scratch database's URL, and the maintenance URL used to create it, derived from a base
 * connection string. Postgres cannot create a database from a connection to that same database,
 * so `CREATE DATABASE` is issued against `postgres`.
 */
export function deriveUrls(baseUrl, scratchName = SCRATCH_DATABASE) {
  const url = new URL(baseUrl);
  if (url.pathname.replace(/^\//, '') === scratchName) {
    throw new Error(
      `DATABASE_URL already points at \`${scratchName}\`, which this check drops and recreates. `
      + 'Point it at the ordinary database instead.',
    );
  }
  const maintenance = new URL(baseUrl);
  maintenance.pathname = '/postgres';
  const scratch = new URL(baseUrl);
  scratch.pathname = `/${scratchName}`;
  return { maintenanceUrl: maintenance.toString(), scratchUrl: scratch.toString() };
}

/**
 * What a `prisma migrate diff --exit-code` status means. 0 is "no difference", 2 is "there is a
 * difference" — a real answer, not a failure. Anything else is the tool itself failing, and must
 * not be reported as drift.
 */
export function classifyDiffExit(code) {
  if (code === 0) return 'in-sync';
  if (code === 2) return 'drift';
  return 'error';
}

/** What the reader has to do about drift. The diff output alone never says this. */
export function driftMessage(diffOutput) {
  const lines = [
    '',
    'SCHEMA DRIFT: prisma/schema.prisma and the committed migration history disagree.',
    '',
    'The differences above are what the schema declares MINUS what applying every committed',
    'migration to an empty database actually builds. The schema is supposed to describe the',
    'deployed database; where they disagree, one of them is wrong and it is not always the schema.',
    '',
    'Fix it in whichever direction is correct:',
    '',
    '  - The MIGRATIONS are right, and the schema failed to describe the database. Correct',
    `    ${SCHEMA_PATH} to match, and add no migration. That is the case for a column whose`,
    '    type or default the database already has and the schema never declared.',
    '',
    '  - The SCHEMA is right, and an intended change has no migration yet. Generate one from the',
    '    schema and commit it. Do not write it by hand, and never edit an applied migration —',
    '    add a new one:',
    '',
    '      npx prisma migrate diff \\',
    '        --from-url "$DATABASE_URL" \\',
    `        --to-schema-datamodel ${SCHEMA_PATH} --script \\`,
    '        > packages/core-api/prisma/migrations/<YYYYMMDDHHMMSS>_<description>/migration.sql',
    '',
    '    Then apply it with `npm run db:test:migrate` and re-run `npm run db:drift:check`.',
    '',
    'Reproduce locally: npm run db:drift:check',
  ];
  if (!diffOutput.trim()) {
    lines.push('', '(prisma reported a difference but printed nothing, which is unexpected.)');
  }
  return lines.join('\n');
}

function prisma(args, { capture = false } = {}) {
  return spawnSync('npx', ['prisma', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function execSql(sql, url) {
  const result = spawnSync('npx', ['prisma', 'db', 'execute', '--url', url, '--stdin'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`\`${sql.trim()}\` failed:\n${result.stderr ?? ''}${result.stdout ?? ''}`);
  }
}

function dropScratch(maintenanceUrl) {
  try {
    execSql(`DROP DATABASE IF EXISTS "${SCRATCH_DATABASE}";`, maintenanceUrl);
  } catch (error) {
    console.warn(`Could not drop \`${SCRATCH_DATABASE}\`: ${error.message}`);
  }
}

function main() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    console.error(
      'Schema drift check: DATABASE_URL is not set. It names the Postgres server to build the '
      + `scratch database \`${SCRATCH_DATABASE}\` on; the database it points at is not touched.`,
    );
    process.exit(1);
  }

  let maintenanceUrl;
  let scratchUrl;
  try {
    ({ maintenanceUrl, scratchUrl } = deriveUrls(baseUrl));
  } catch (error) {
    console.error(`Schema drift check: ${error.message}`);
    process.exit(1);
  }

  console.log(`Schema drift check: building \`${SCRATCH_DATABASE}\` from the migration history.`);
  dropScratch(maintenanceUrl);
  try {
    execSql(`CREATE DATABASE "${SCRATCH_DATABASE}";`, maintenanceUrl);
  } catch (error) {
    console.error(`Schema drift check: could not create the scratch database.\n${error.message}`);
    process.exit(1);
  }

  // `process.exit` inside a `try` does not run its `finally`, so the scratch database would leak
  // on exactly the failure paths. Decide the exit code, drop the database, then exit.
  let exitCode = 0;
  try {
    const deployed = spawnSync(
      'npx',
      ['prisma', 'migrate', 'deploy', '--schema', SCHEMA_PATH],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_URL: scratchUrl }, stdio: 'inherit' },
    );
    if (deployed.status !== 0) {
      console.error(
        '\nSchema drift check: `prisma migrate deploy` failed against an empty database. The '
        + 'migration history cannot be applied from scratch, which is a worse problem than drift '
        + '— a new environment could not be built. Fix the failing migration above.',
      );
      exitCode = 1;
    } else {
      const diff = prisma(
        [
          'migrate', 'diff',
          '--from-url', scratchUrl,
          '--to-schema-datamodel', SCHEMA_PATH,
          '--exit-code',
        ],
        { capture: true },
      );
      const output = `${diff.stdout ?? ''}${diff.stderr ?? ''}`;
      const verdict = classifyDiffExit(diff.status);

      if (verdict === 'in-sync') {
        console.log('Schema drift check OK — schema.prisma matches the migration history.');
      } else if (verdict === 'error') {
        console.error(output);
        console.error(
          `\nSchema drift check: \`prisma migrate diff\` exited ${diff.status}, which is neither `
          + '"in sync" (0) nor "differences found" (2). That is the tool failing, not drift.',
        );
        exitCode = 1;
      } else {
        console.error(output);
        console.error(driftMessage(output));
        exitCode = 1;
      }
    }
  } finally {
    dropScratch(maintenanceUrl);
  }
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
