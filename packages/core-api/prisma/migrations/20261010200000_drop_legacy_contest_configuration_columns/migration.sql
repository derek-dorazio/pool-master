-- #587: a contest's rules live only in config_json since #93's typed contest rules, which folded
-- budget contests' legacy budget / roster_size / pick_count values into it. Nothing reads or
-- writes these columns any more.
ALTER TABLE "contest_configurations"
  DROP COLUMN "budget",
  DROP COLUMN "pick_count",
  DROP COLUMN "roster_size";
