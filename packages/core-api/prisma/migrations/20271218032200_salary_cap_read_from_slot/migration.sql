-- A budget contest's salary cap is read from the pricing of the first slot it covers (#2050),
-- never from its rules: drop the copy each budget configuration took when it was saved.
UPDATE "contest_configurations"
SET "config_json" = "config_json" - 'salaryCap'
WHERE "config_json" ? 'salaryCap';
