/**
 * Prisma seed script.
 *
 * Current policy:
 * - no demo, fake, or convenience seed data
 * - no tenant/bootstrap identity fixtures before the tenant/auth redesign lands
 * - keep the seed step runnable in CI/deploy flows so the pipeline path stays valid
 *
 * A minimal root bootstrap user, if still needed, should be reintroduced only after
 * Plan 63 completes the tenant-free auth model.
 */

async function main(): Promise<void> {
  console.log('Seed step: no-op by policy.');
  console.log('No seed data inserted.');
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
