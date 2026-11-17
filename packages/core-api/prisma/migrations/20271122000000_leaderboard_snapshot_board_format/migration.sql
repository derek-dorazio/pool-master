-- #1761: each stored leaderboard records the board format it was written under, so a board stored
-- before a deploy that changes a leaderboard's shape is computed again rather than served. The
-- boards stored now predate any format, so they take 0, which the code never serves.
ALTER TABLE "contest_leaderboard_snapshots" ADD COLUMN "board_format" INTEGER NOT NULL DEFAULT 0;
