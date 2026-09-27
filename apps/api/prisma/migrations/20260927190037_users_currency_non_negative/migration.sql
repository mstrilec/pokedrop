-- Hand-written: Prisma has no syntax for check constraints.
--
-- The backstop behind the pack open's conditional debit, and behind every
-- later path that touches a balance: a bug can refuse a spend, never overdraw.

ALTER TABLE "users"
  ADD CONSTRAINT users_currency_non_negative CHECK ("currency" >= 0);
