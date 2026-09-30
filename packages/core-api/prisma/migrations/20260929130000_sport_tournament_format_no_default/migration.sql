-- #236: Sport.tournamentFormat loses its STROKE_PLAY_TOURNAMENT default. A sport row
-- created without an explicit format silently became stroke-play golf; creators now
-- supply it (DEFAULT_TOURNAMENT_FORMAT_BY_SPORT). Existing rows keep their values.
ALTER TABLE "sports" ALTER COLUMN "tournament_format" DROP DEFAULT;
