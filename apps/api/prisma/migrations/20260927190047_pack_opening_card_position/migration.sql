-- Added with a default so the existing rows can be numbered, then the default
-- is dropped so every new row must state its position.
ALTER TABLE "pack_opening_cards" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "pack_opening_cards" AS c
SET "position" = n.pos
FROM (
  SELECT id, row_number() OVER (PARTITION BY "packOpeningId" ORDER BY id) - 1 AS pos
  FROM "pack_opening_cards"
) AS n
WHERE c.id = n.id;

ALTER TABLE "pack_opening_cards" ALTER COLUMN "position" DROP DEFAULT;
