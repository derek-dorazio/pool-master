-- plans/145 slice 3, #244. Write-only: every managed contest got one row reading
-- SUM_ALL_ENTRIES while the calculator sums entry totals regardless, and after #234 emptied its
-- config that constant was all the table held. Reintroduce if configurable aggregation is built.
DROP TABLE "contest_entry_aggregation_rules";
