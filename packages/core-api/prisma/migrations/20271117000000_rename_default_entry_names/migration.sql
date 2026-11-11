-- #1564: a new entry's default name is "<team> <n>" ("Incubus 1"), no longer "<team> Entry <n>".
-- Rename the entries still carrying the old default exactly, so a leaderboard reads the same for
-- old and new entries. A name its owner chose, or one that no longer matches its team's current
-- name, stays as it is, and so does an entry whose team already has another entry in the contest
-- by the new name (a team's entries in one contest keep distinct names).
UPDATE contest_entries AS entry
SET name = squad.name || ' ' || entry.entry_number::text,
    updated_at = now()
FROM squads AS squad
WHERE squad.id = entry.squad_id
  AND entry.name = squad.name || ' Entry ' || entry.entry_number::text
  AND NOT EXISTS (
    SELECT 1
    FROM contest_entries AS sibling
    WHERE sibling.contest_id = entry.contest_id
      AND sibling.squad_id = entry.squad_id
      AND sibling.id <> entry.id
      AND lower(trim(sibling.name)) = lower(squad.name || ' ' || entry.entry_number::text)
  );
