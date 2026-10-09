-- #516 — the POLL_INTERVAL_CONFIG settings group is gone: no client ever read it (the web app
-- polls on its own constant), so its routes, admin page and registry entry were deleted. Its
-- stored value and its change history go with it; nothing reads a key the registry does not
-- declare, and the typed settings history has no schema to publish its values under.

DELETE FROM "platform_runtime_config_history" WHERE "config_key" = 'POLL_INTERVAL_CONFIG';
DELETE FROM "platform_runtime_configs" WHERE "config_key" = 'POLL_INTERVAL_CONFIG';
