-- League model 1d (#2039): the QA mock contest feed no longer runs in any environment, so the rows
-- it wrote go. Its participant mappings name competitors no feed will send again, and its sync
-- runs describe a provider that is gone. Nothing references either table's rows by foreign key.
-- The events linked to it stay: slice 7 removes manual score-source links with their own
-- migration, and no sync reads an event whose provider is not running.

DELETE FROM participant_provider_mappings WHERE provider_id = 'mock-contest-feed';

DELETE FROM provider_sync_runs WHERE provider_id = 'mock-contest-feed';
