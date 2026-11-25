-- #2096 (carried by #2075): a participant a QA test makes for a test slot's field, marked as test
-- slots are. In a provider-synced league it is the one participant made without a feed id: it
-- joins only a test slot's field, gets no provider mapping, and no roster or sync reads it.
ALTER TABLE "participants" ADD COLUMN "is_test_data" BOOLEAN NOT NULL DEFAULT false;
