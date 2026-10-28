-- A released edition finds the contests made from its series' templates through template_id (#1179).
CREATE INDEX "contest_configurations_template_id_idx" ON "contest_configurations"("template_id");
