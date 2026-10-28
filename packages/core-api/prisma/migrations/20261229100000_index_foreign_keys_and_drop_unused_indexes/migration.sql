-- #1167, #1168, #1177, #1178: an index leading on every foreign key column, so a delete or a
-- per-user, per-squad read does not scan the referencing table; indexes for the recurring sweeps;
-- and dropping the indexes nothing reads or another index already leads with.

-- DropIndex
DROP INDEX "participants_sport_id_idx";

-- DropIndex
DROP INDEX "sport_event_participant_rounds_sport_event_participant_id_idx";

-- DropIndex
DROP INDEX "sport_event_participant_standings_position_idx";

-- DropIndex
DROP INDEX "sport_event_participant_standings_status_idx";

-- DropIndex
DROP INDEX "sport_event_participants_sport_event_id_idx";

-- DropIndex
DROP INDEX "contest_prize_definitions_contest_configuration_id_idx";

-- DropIndex
DROP INDEX "contests_league_id_idx";

-- DropIndex
DROP INDEX "participant_contest_scoring_rules_contest_configuration_id_idx";

-- CreateIndex
CREATE INDEX "contest_configurations_template_id_idx" ON "contest_configurations"("template_id");

-- CreateIndex
CREATE INDEX "contest_draws_drawn_by_user_id_idx" ON "contest_draws"("drawn_by_user_id");

-- CreateIndex
CREATE INDEX "contest_entries_squad_id_idx" ON "contest_entries"("squad_id");

-- CreateIndex
CREATE INDEX "contest_entry_event_standings_sport_event_id_idx" ON "contest_entry_event_standings"("sport_event_id");

-- CreateIndex
CREATE INDEX "contest_entry_picks_sport_event_participant_id_idx" ON "contest_entry_picks"("sport_event_participant_id");

-- CreateIndex
CREATE INDEX "contest_entry_squares_claimed_by_user_id_idx" ON "contest_entry_squares"("claimed_by_user_id");

-- CreateIndex
CREATE INDEX "contest_squares_draws_drawn_by_user_id_idx" ON "contest_squares_draws"("drawn_by_user_id");

-- CreateIndex
CREATE INDEX "cups_sport_league_id_idx" ON "cups"("sport_league_id");

-- CreateIndex
CREATE INDEX "email_messages_entry_id_idx" ON "email_messages"("entry_id");

-- CreateIndex
CREATE INDEX "email_messages_league_id_created_at_idx" ON "email_messages"("league_id", "created_at");

-- CreateIndex
CREATE INDEX "email_messages_recipient_user_id_created_at_idx" ON "email_messages"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "email_suppressions_email_message_id_idx" ON "email_suppressions"("email_message_id");

-- CreateIndex
CREATE INDEX "event_pages_redirect_to_page_id_idx" ON "event_pages"("redirect_to_page_id");

-- CreateIndex
CREATE INDEX "league_invitations_invited_by_idx" ON "league_invitations"("invited_by");

-- CreateIndex
CREATE INDEX "league_invitations_accepted_by_idx" ON "league_invitations"("accepted_by");

-- CreateIndex
CREATE INDEX "league_memberships_user_id_status_idx" ON "league_memberships"("user_id", "status");

-- CreateIndex
CREATE INDEX "league_memberships_status_joined_at_idx" ON "league_memberships"("status", "joined_at");

-- CreateIndex
CREATE INDEX "league_payments_contest_id_idx" ON "league_payments"("contest_id");

-- CreateIndex
CREATE INDEX "league_plan_changes_changed_by_id_idx" ON "league_plan_changes"("changed_by_id");

-- CreateIndex
CREATE INDEX "league_plan_renewal_changes_changed_by_id_idx" ON "league_plan_renewal_changes"("changed_by_id");

-- CreateIndex
CREATE INDEX "league_year_finishes_squad_id_idx" ON "league_year_finishes"("squad_id");

-- CreateIndex
CREATE INDEX "league_year_reviews_sent_by_user_id_idx" ON "league_year_reviews"("sent_by_user_id");

-- CreateIndex
CREATE INDEX "leagues_plan_renews_at_idx" ON "leagues"("plan_renews_at");

-- CreateIndex
CREATE INDEX "sport_event_participant_rounds_sport_event_round_id_idx" ON "sport_event_participant_rounds"("sport_event_round_id");

-- CreateIndex
CREATE INDEX "sport_events_status_idx" ON "sport_events"("status");

-- CreateIndex
CREATE INDEX "squad_memberships_user_id_idx" ON "squad_memberships"("user_id");

-- CreateIndex
CREATE INDEX "squad_owner_invitations_invited_by_idx" ON "squad_owner_invitations"("invited_by");

-- CreateIndex
CREATE INDEX "squad_owner_invitations_accepted_by_idx" ON "squad_owner_invitations"("accepted_by");

-- CreateIndex
CREATE INDEX "squads_created_by_idx" ON "squads"("created_by");

-- CreateIndex
CREATE INDEX "users_is_root_admin_is_active_idx" ON "users"("is_root_admin", "is_active");

