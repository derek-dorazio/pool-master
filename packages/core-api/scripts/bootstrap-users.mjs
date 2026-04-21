import bcrypt from 'bcryptjs';
import { PrismaClient, UserAuthProvider } from '@prisma/client';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function upsertUser(entry) {
  const email = entry.email?.trim().toLowerCase();
  const username = entry.username?.trim().toLowerCase();
  const password = entry.password;
  const firstName = entry.firstName?.trim() || 'Test';
  const lastName = entry.lastName?.trim() || 'User';
  const isRootAdmin = Boolean(entry.isRootAdmin);

  if (!email || !username || !password) {
    console.error(`Skipping fixture entry with missing email/username/password: ${JSON.stringify(entry)}`);
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
      isRootAdmin,
    },
    create: {
      email,
      username,
      firstName,
      lastName,
      passwordHash,
      authProvider: UserAuthProvider.EMAIL,
      isRootAdmin,
    },
    select: { id: true, email: true, username: true, isRootAdmin: true },
  });

  console.log(`Upserted ${user.email} (username=${user.username}, isRootAdmin=${user.isRootAdmin})`);
}

async function main() {
  const raw = process.env.FIXTURE_JSON;
  if (!raw) {
    fail('FIXTURE_JSON env var is required (pass the test-users fixture content).');
  }

  let users;
  try {
    users = JSON.parse(raw);
  } catch (error) {
    fail(`FIXTURE_JSON must be valid JSON: ${error.message}`);
  }

  if (!Array.isArray(users) || users.length === 0) {
    fail('FIXTURE_JSON must be a non-empty JSON array of user objects.');
  }

  for (const entry of users) {
    await upsertUser(entry);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
