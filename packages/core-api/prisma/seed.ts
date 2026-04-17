/**
 * Prisma seed script.
 *
 * Current policy:
 * - no demo, fake, or convenience seed data
 * - keep the seed step runnable in CI/deploy flows so the pipeline path stays valid
 * - allow at most one env-configured root bootstrap user
 */

import bcrypt from 'bcryptjs';
import { PrismaClient, UserAuthProvider } from '@prisma/client';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

async function main(): Promise<void> {
  const email = process.env.ROOT_ADMIN_EMAIL?.trim().toLowerCase();
  const username = process.env.ROOT_ADMIN_USERNAME?.trim().toLowerCase() || email;
  const password = process.env.ROOT_ADMIN_PASSWORD;
  const legacyDisplayName = process.env.ROOT_ADMIN_DISPLAY_NAME?.trim();
  const firstName =
    process.env.ROOT_ADMIN_FIRST_NAME?.trim() ||
    legacyDisplayName?.split(/\s+/)[0] ||
    'Root';
  const lastName =
    process.env.ROOT_ADMIN_LAST_NAME?.trim() ||
    legacyDisplayName?.split(/\s+/).slice(1).join(' ').trim() ||
    'Admin';

  if (!email || !username || !password) {
    console.log('Seed step: no bootstrap root-admin configured.');
    console.log('No seed data inserted.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      username,
      firstName,
      lastName,
      passwordHash,
      isRootAdmin: true,
    },
    create: {
      email,
      username,
      firstName,
      lastName,
      passwordHash,
      authProvider: UserAuthProvider.EMAIL,
      isRootAdmin: true,
    },
    select: {
      id: true,
      email: true,
      isRootAdmin: true,
    },
  });

  console.log(`Seed step: ensured bootstrap root-admin user ${user.email}.`);
  console.log(`Root-admin enabled: ${user.isRootAdmin}`);
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
