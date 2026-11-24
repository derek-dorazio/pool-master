-- A field sync's follow-ups (provider games, then tiers and prices) run as a background job (#1952).
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'SYNC_EVENT_GAMES_AND_TIERS';
