-- Production pack templates modelled on real booster packs (PD-130).
-- docs/Deployment.md has the sources and the rates they produce.
--
--   docker compose -f compose.production.yml --env-file .env.production \
--     exec -T postgres psql -U pokedrop -d pokedrop -v ON_ERROR_STOP=1 < deploy/pack-templates.sql
--
-- Safe to run again: an existing id is left as it is, so edits made on
-- /admin/packs survive. Nothing is written when a set lacks a rarity the
-- template names, the rule POST /admin/pack-templates enforces.

BEGIN;

CREATE TEMP TABLE new_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  cost int NOT NULL,
  set_id text NOT NULL,
  slot_config jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO new_templates VALUES
  ('pack-base1', 'Base Set', 500, 'base1', '{"slots": [
    {"count": 5, "weights": {"Common": 1}},
    {"count": 3, "weights": {"Uncommon": 1}},
    {"count": 1, "weights": {"Rare": 2, "Rare Holo": 1}}
  ]}'),
  ('pack-swsh7', 'Evolving Skies', 300, 'swsh7', '{"slots": [
    {"count": 5, "weights": {"Common": 1}},
    {"count": 3, "weights": {"Uncommon": 1}},
    {"count": 1, "weights": {"Uncommon": 385, "Common": 323, "Rare Holo": 152, "Rare": 145}},
    {"count": 1, "weights": {"Rare": 588, "Rare Holo": 182, "Rare Holo V": 105, "Rare Holo VMAX": 56,
                             "Rare Ultra": 39, "Rare Rainbow": 11, "Rare Secret": 9}}
  ]}'),
  ('pack-sv1', 'Scarlet & Violet', 150, 'sv1', '{"slots": [
    {"count": 4, "weights": {"Common": 1}},
    {"count": 3, "weights": {"Uncommon": 1}},
    {"count": 1, "weights": {"Common": 58, "Uncommon": 31, "Rare": 11}},
    {"count": 1, "weights": {"Common": 507, "Uncommon": 269, "Rare": 97, "Illustration Rare": 77,
                             "Special Illustration Rare": 32, "Hyper Rare": 18}},
    {"count": 1, "weights": {"Rare": 791, "Double Rare": 141, "Ultra Rare": 68}}
  ]}'),
  ('pack-sv3pt5', 'Scarlet & Violet 151', 200, 'sv3pt5', '{"slots": [
    {"count": 4, "weights": {"Common": 1}},
    {"count": 3, "weights": {"Uncommon": 1}},
    {"count": 1, "weights": {"Common": 58, "Uncommon": 31, "Rare": 11}},
    {"count": 1, "weights": {"Common": 507, "Uncommon": 269, "Rare": 97, "Illustration Rare": 77,
                             "Special Illustration Rare": 32, "Hyper Rare": 18}},
    {"count": 1, "weights": {"Rare": 791, "Double Rare": 141, "Ultra Rare": 68}}
  ]}');

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t.name || ' (' || t.set_id || '): ' || r.rarity, ', ')
    INTO missing
    FROM new_templates t
    CROSS JOIN LATERAL (
      SELECT DISTINCT k AS rarity
        FROM jsonb_array_elements(t.slot_config -> 'slots') AS s,
             jsonb_object_keys(s -> 'weights') AS k
    ) r
   WHERE NOT EXISTS (
     SELECT 1 FROM cards c WHERE c."setId" = t.set_id AND c.rarity = r.rarity
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'No cards in the catalog for: % — run the catalog sync first', missing;
  END IF;
END $$;

INSERT INTO pack_templates (id, name, "setFilter", cost, "slotConfig", active)
SELECT id, name, jsonb_build_object('setIds', jsonb_build_array(set_id)), cost, slot_config, true
  FROM new_templates
ON CONFLICT (id) DO NOTHING;

SELECT id, name, cost, active FROM pack_templates WHERE id LIKE 'pack-%' ORDER BY cost;

COMMIT;
