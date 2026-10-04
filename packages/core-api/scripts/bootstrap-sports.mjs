#!/usr/bin/env node
/* global console, process */
/**
 * Upsert the sport rows the app needs to be usable. Idempotent; safe to run any time.
 *
 * The sport catalog's root rows are reference data that nothing else restores. There is no
 * Prisma seed in this repository — no `prisma.seed` config, no seed file, no migration that
 * inserts a sport — so a reset database has an empty `sports` table, and every golf admin
 * screen is dead: `golfSportQueryOptions` throws "The golf sport is not set up." when the list
 * holds no GOLF row, which fails the query the player, tour and tournament lists render from.
 *
 * The first QA reset proved it the hard way. `reset-qa-database.mjs` restored the fixture users
 * and nothing else, so the post-deploy journey failed in act 1 waiting for a player table that
 * could never render. plans/129 asked for "the small amount of data the app needs to run"; the
 * users were only half of it.
 *
 * GOLF only, deliberately. It is the one sport the product implements — creating an event for
 * any other is refused with 422 SPORT_NOT_SUPPORTED — and `PrismaSportCategory` has no value
 * for several of the enum's sports, so seeding them all would invent rows nothing can use. The
 * row is exactly the one the functional suites create for themselves.
 *
 * Usage:
 *   node scripts/bootstrap-sports.mjs
 *
 * Environment: DATABASE_URL.
 */

import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

/**
 * `tournamentFormat` has no column default on purpose (#236): the table that discriminates
 * between sports must not make a row a stroke-play golf sport by omission. So it is stated here.
 */
export const SPORTS = [
  {
    name: 'GOLF',
    participantType: 'INDIVIDUAL',
    category: 'GOLF',
    tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
  },
];

export async function bootstrapSports(prisma, sports = SPORTS) {
  const results = [];
  for (const sport of sports) {
    const row = await prisma.sport.upsert({
      where: { name: sport.name },
      create: sport,
      // Left alone: an existing row may have been corrected by hand, and this script's job is
      // to guarantee the row exists, not to own its contents.
      update: {},
      select: { id: true, name: true, participantType: true, tournamentFormat: true },
    });
    results.push(row);
    console.log(`Upserted sport ${row.name} (participantType=${row.participantType}, tournamentFormat=${row.tournamentFormat})`);
  }
  return results;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }
  const prisma = new PrismaClient();
  try {
    await bootstrapSports(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
