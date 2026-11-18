-- #1850: the sync matches a feed participant by its feed id only. One whose id no participant is
-- mapped to is created, so nothing waits as "needs linking" any more, and the rows #1824 kept for
-- it go. QA's data is all test data, rebuilt after this lands; no environment holds real rows.

-- DropTable
DROP TABLE "ambiguous_feed_participant_sightings";

-- DropTable
DROP TABLE "ambiguous_feed_participants";
