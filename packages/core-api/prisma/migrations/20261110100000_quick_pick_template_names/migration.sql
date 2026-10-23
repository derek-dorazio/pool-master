-- #878: the Random draw format is called "Quick pick" on screen, so every template name that
-- leads with the format's old name leads with the new one ("Quick pick: 1 golfer each").
UPDATE contest_config_templates
SET name = 'Quick pick' || substr(name, 12)
WHERE name LIKE 'Random draw%';
