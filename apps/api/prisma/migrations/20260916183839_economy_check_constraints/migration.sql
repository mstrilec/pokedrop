-- Hand-written: Prisma has no syntax for check constraints.
--
-- Safe to keep here. Prisma's migration engine models tables, columns, indexes
-- and foreign keys; it has no concept of a check constraint, so it neither
-- reports these as drift nor generates a DROP for them on later migrations.
-- Verified by replaying this history into an empty database.
--
-- Note the blank line above the first statement. `prisma migrate dev
-- --create-only` writes its placeholder comment without a trailing newline, so
-- appending to the file silently turns the first statement into part of that
-- comment.

-- inventory_quantity_non_negative is implied by the two below: if
-- lockedQuantity >= 0 and lockedQuantity <= quantity, then quantity >= 0. It is
-- kept as an explicit statement of intent, and it still holds if the other two
-- are ever relaxed.
ALTER TABLE "inventory_items"
  ADD CONSTRAINT inventory_quantity_non_negative CHECK ("quantity" >= 0);

ALTER TABLE "inventory_items"
  ADD CONSTRAINT inventory_locked_non_negative CHECK ("lockedQuantity" >= 0);

-- The one that stops a card being promised to two trades at once.
ALTER TABLE "inventory_items"
  ADD CONSTRAINT inventory_locked_within_quantity CHECK ("lockedQuantity" <= "quantity");

-- Not in the ticket, but the same class of hole: a negative cost would pay the
-- user for opening a pack.
ALTER TABLE "pack_templates"
  ADD CONSTRAINT pack_template_cost_non_negative CHECK ("cost" >= 0);
