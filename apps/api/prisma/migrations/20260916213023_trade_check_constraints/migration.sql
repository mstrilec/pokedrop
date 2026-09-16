-- Hand-written; Prisma has no syntax for check constraints. See the
-- economy_check_constraints migration for why keeping them here is safe.
--
-- The file is overwritten rather than appended to: `--create-only` writes its
-- placeholder comment with no trailing newline, and appending would make the
-- first statement part of that comment.

-- No trading with yourself. Without this, one account can move cards and
-- currency between its own two sides of a trade and launder provenance.
ALTER TABLE "trades"
  ADD CONSTRAINT trade_not_self CHECK ("initiatorId" <> "recipientId");

-- A counter-offer cannot replace itself. This only rules out a one-step cycle;
-- longer cycles are impossible because a counter is always a new row pointing
-- at an older one.
ALTER TABLE "trades"
  ADD CONSTRAINT trade_not_self_counter CHECK ("counteredTradeId" IS NULL OR "counteredTradeId" <> "id");

-- Currency moves in both directions independently, but never negatively: a
-- negative side would pull currency out of the counterparty instead of giving.
ALTER TABLE "trades"
  ADD CONSTRAINT trade_currency_from_initiator_non_negative CHECK ("currencyFromInitiator" >= 0);

ALTER TABLE "trades"
  ADD CONSTRAINT trade_currency_from_recipient_non_negative CHECK ("currencyFromRecipient" >= 0);

ALTER TABLE "trade_items"
  ADD CONSTRAINT trade_item_quantity_positive CHECK ("quantity" >= 1);

-- The max-copies rule is not here on purpose: basic energy is exempt from it
-- and this table cannot see the card's supertype.
ALTER TABLE "deck_cards"
  ADD CONSTRAINT deck_card_count_positive CHECK ("count" >= 1);
