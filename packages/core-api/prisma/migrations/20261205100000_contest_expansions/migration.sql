-- Contest expansions and the league payment history (#980, plans/payments.md §4, §10).
-- An expansion raises one contest's entry cap; each one has a payment history line, $0 while
-- payments are off or when a root admin gives it. No behaviour changes until a row exists.

-- CreateEnum
CREATE TYPE "PrismaLeaguePaymentKind" AS ENUM ('CONTEST_EXPANSION_PAYMENTS_OFF', 'CONTEST_EXPANSION_GRANT');

-- CreateTable
CREATE TABLE "league_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "contest_id" UUID,
    "payer_id" UUID,
    "kind" "PrismaLeaguePaymentKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_expansions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "entries_per_contest" INTEGER NOT NULL,
    "payment_id" UUID NOT NULL,
    "expanded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_expansions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "league_payments_league_id_paid_at_idx" ON "league_payments"("league_id", "paid_at" DESC);

-- CreateIndex
CREATE INDEX "league_payments_payer_id_paid_at_idx" ON "league_payments"("payer_id", "paid_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "contest_expansions_payment_id_key" ON "contest_expansions"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_expansions_contest_id_entries_per_contest_key" ON "contest_expansions"("contest_id", "entries_per_contest");

-- AddForeignKey
ALTER TABLE "league_payments" ADD CONSTRAINT "league_payments_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_payments" ADD CONSTRAINT "league_payments_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_payments" ADD CONSTRAINT "league_payments_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_expansions" ADD CONSTRAINT "contest_expansions_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_expansions" ADD CONSTRAINT "contest_expansions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "league_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheck
ALTER TABLE "league_payments" ADD CONSTRAINT "league_payments_amount_cents_not_negative"
    CHECK ("amount_cents" >= 0);

-- AddCheck
ALTER TABLE "contest_expansions" ADD CONSTRAINT "contest_expansions_entries_per_contest_positive"
    CHECK ("entries_per_contest" >= 1);
