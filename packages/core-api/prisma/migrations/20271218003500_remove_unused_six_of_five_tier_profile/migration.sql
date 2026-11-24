-- #2059: the "6 tiers of 5" tier profile was named only by the old Clutch Card leagues, which
-- league model 1b removed, so it is a platform profile nothing uses. It goes, found by its id.
-- A sport league a root admin has since pointed at it keeps it: the delete skips a profile any
-- sport league names, rather than failing on the foreign key or re-pointing a league's choice.
-- Clutch Card tier sets come back with slice 26 (#2030), from whatever profile that slice seeds.

DELETE FROM tier_profiles
  WHERE id = '3ab96023-4255-43c1-ab20-f4c79ae926ec'
    AND NOT EXISTS (SELECT 1 FROM sport_leagues WHERE tier_profile_id = tier_profiles.id);
