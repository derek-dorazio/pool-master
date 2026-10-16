-- #695: an entry's settled total moves onto the core standing row. Golf kept it in
-- contest_entry_golf_standings.total_score_to_par and racing in
-- contest_entry_race_standings.total_points, one 1:1 table per scoring family. The unit and
-- direction already come from the contest's scoring definition, so one column serves every family.

ALTER TABLE "contest_entry_standings" ADD COLUMN "total_score" INTEGER;

-- Carry every settled total across before the family tables go. A standing has at most one of the
-- two rows (settlement writes only its own family's), so the order of these updates does not matter.
UPDATE "contest_entry_standings" AS standing
SET "total_score" = golf."total_score_to_par"
FROM "contest_entry_golf_standings" AS golf
WHERE golf."contest_entry_standing_id" = standing."id";

UPDATE "contest_entry_standings" AS standing
SET "total_score" = race."total_points"
FROM "contest_entry_race_standings" AS race
WHERE race."contest_entry_standing_id" = standing."id";

DROP TABLE "contest_entry_golf_standings";
DROP TABLE "contest_entry_race_standings";
