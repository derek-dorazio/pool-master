-- #624: the auto racing sport (car racing: NASCAR Cup Series, IndyCar).
--
-- AUTO_RACING joins the sport enum. It reuses the finish-position scoring family and its tables,
-- and the RACE tournament format, both added with horse racing, so nothing else changes. The new
-- value is only added here, never used, so ALTER TYPE ... ADD VALUE is safe inside this
-- migration's transaction; the sports row, its sport leagues and its contest templates, which use
-- it, are the next migration.

ALTER TYPE "PrismaSport" ADD VALUE 'AUTO_RACING';
