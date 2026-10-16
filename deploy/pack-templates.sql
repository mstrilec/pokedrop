-- Production pack templates modelled on real booster packs (PD-130): nineteen
-- sets from Base Set (1999) to Mega Evolution (2025).
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
  set_ids jsonb NOT NULL,
  slot_config jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO new_templates VALUES
  ('pack-base1', 'Base Set', 500, '["base1"]', '{"slots": [
    {"count": 5, "weights": {"Common": 1}},
    {"count": 3, "weights": {"Uncommon": 1}},
    {"count": 1, "weights": {"Rare": 2, "Rare Holo": 1}}
  ]}'),
  ('pack-swsh7', 'Evolving Skies', 300, '["swsh7"]', '{"slots": [
    {"count": 5, "weights": {"Common": 1}},
    {"count": 3, "weights": {"Uncommon": 1}},
    {"count": 1, "weights": {"Uncommon": 385, "Common": 323, "Rare Holo": 152, "Rare": 145}},
    {"count": 1, "weights": {"Rare": 588, "Rare Holo": 182, "Rare Holo V": 105, "Rare Holo VMAX": 56,
                             "Rare Ultra": 39, "Rare Rainbow": 11, "Rare Secret": 9}}
  ]}'),
  ('pack-sv1', 'Scarlet & Violet', 150, '["sv1"]', '{"slots": [
    {"count": 4, "weights": {"Common": 1}},
    {"count": 3, "weights": {"Uncommon": 1}},
    {"count": 1, "weights": {"Common": 58, "Uncommon": 31, "Rare": 11}},
    {"count": 1, "weights": {"Common": 507, "Uncommon": 269, "Rare": 97, "Illustration Rare": 77,
                             "Special Illustration Rare": 32, "Hyper Rare": 18}},
    {"count": 1, "weights": {"Rare": 791, "Double Rare": 141, "Ultra Rare": 68}}
  ]}'),
  ('pack-sv3pt5', 'Scarlet & Violet 151', 200, '["sv3pt5"]', '{"slots": [
    {"count": 4, "weights": {"Common": 1}},
    {"count": 3, "weights": {"Uncommon": 1}},
    {"count": 1, "weights": {"Common": 58, "Uncommon": 31, "Rare": 11}},
    {"count": 1, "weights": {"Common": 507, "Uncommon": 269, "Rare": 97, "Illustration Rare": 77,
                             "Special Illustration Rare": 32, "Hyper Rare": 18}},
    {"count": 1, "weights": {"Rare": 791, "Double Rare": 141, "Ultra Rare": 68}}
  ]}'),
  ('pack-base2', 'Jungle', 450, '["base2"]', '{"slots": [
    {"count":7,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Rare":667,"Rare Holo":333}}
  ]}'),
  ('pack-base3', 'Fossil', 450, '["base3"]', '{"slots": [
    {"count":7,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Rare":667,"Rare Holo":333}}
  ]}'),
  ('pack-base5', 'Team Rocket', 450, '["base5"]', '{"slots": [
    {"count":7,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Rare":667,"Rare Holo":313,"Rare Secret":20}}
  ]}'),
  ('pack-neo1', 'Neo Genesis', 400, '["neo1"]', '{"slots": [
    {"count":6,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Rare":667,"Rare Holo":333}}
  ]}'),
  ('pack-xy12', 'Evolutions', 300, '["xy12"]', '{"slots": [
    {"count":5,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Common":370,"Uncommon":323,"Rare Holo":101,"Rare":70}},
    {"count":1,"weights":{"Rare":667,"Rare Holo":145,"Rare Secret":123,"Rare Holo EX":122,"Rare Ultra":67,"Rare BREAK":56}}
  ]}'),
  ('pack-sm12', 'Cosmic Eclipse', 250, '["sm12"]', '{"slots": [
    {"count":5,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Uncommon":313,"Common":313,"Rare":179,"Rare Holo":103}},
    {"count":1,"weights":{"Rare":667,"Rare Holo":145,"Rare Holo GX":128,"Rare Ultra":38,"Rare Rainbow":14,"Rare Secret":9}}
  ]}'),
  ('pack-swsh11', 'Lost Origin', 250, '["swsh11","swsh11tg"]', '{"slots": [
    {"count":5,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Uncommon":278,"Common":270,"Rare":156,"Rare Holo":122,"Trainer Gallery Rare Holo":85,"Radiant Rare":50,"Rare Holo V":12,"Rare Ultra":10,"Rare Secret":9,"Rare Holo VMAX":7}},
    {"count":1,"weights":{"Rare":588,"Rare Holo":179,"Rare Holo V":116,"Rare Ultra":39,"Rare Holo VSTAR":38,"Rare Rainbow":13,"Rare Secret":8,"Rare Holo VMAX":6}}
  ]}'),
  ('pack-swsh12pt5', 'Crown Zenith', 300, '["swsh12pt5","swsh12pt5gg"]', '{"slots": [
    {"count":5,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Trainer Gallery Rare Holo":222,"Common":222,"Uncommon":154,"Rare":118,"Rare Holo":106,"Radiant Rare":45,"Rare Ultra":37,"Rare Holo VSTAR":37,"Rare Holo V":34,"Rare Holo VMAX":11,"Rare Secret":8}},
    {"count":1,"weights":{"Rare":625,"Rare Holo":179,"Rare Holo V":123,"Rare Holo VSTAR":33,"Rare Ultra":28,"Rare Holo VMAX":20,"Rare Secret":8}}
  ]}'),
  ('pack-sv2', 'Paldea Evolved', 150, '["sv2"]', '{"slots": [
    {"count":4,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Common":4466,"Uncommon":4123,"Rare":1410}},
    {"count":1,"weights":{"Common":3899,"Uncommon":3600,"Rare":1231,"Illustration Rare":770,"Special Illustration Rare":320,"Hyper Rare":180}},
    {"count":1,"weights":{"Rare":7690,"Double Rare":1370,"Ultra Rare":660}}
  ]}'),
  ('pack-sv3', 'Obsidian Flames', 150, '["sv3"]', '{"slots": [
    {"count":4,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Common":5333,"Uncommon":4101,"Rare":565}},
    {"count":1,"weights":{"Common":4661,"Uncommon":3585,"Rare":494,"Illustration Rare":760,"Special Illustration Rare":310,"Hyper Rare":190}},
    {"count":1,"weights":{"Rare":7690,"Double Rare":1370,"Ultra Rare":660}}
  ]}'),
  ('pack-sv4', 'Paradox Rift', 150, '["sv4"]', '{"slots": [
    {"count":4,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Common":4921,"Uncommon":3384,"Rare":1695}},
    {"count":1,"weights":{"Common":4380,"Uncommon":3012,"Rare":1508,"Illustration Rare":770,"Special Illustration Rare":210,"Hyper Rare":120}},
    {"count":1,"weights":{"Rare":7690,"Double Rare":1560,"Ultra Rare":660}}
  ]}'),
  ('pack-sv8', 'Surging Sparks', 180, '["sv8"]', '{"slots": [
    {"count":4,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Common":5417,"Uncommon":3613,"Rare":970}},
    {"count":1,"weights":{"Common":4638,"Uncommon":3094,"Rare":830,"Illustration Rare":770,"ACE SPEC Rare":500,"Special Illustration Rare":115,"Hyper Rare":53}},
    {"count":1,"weights":{"Rare":7690,"Double Rare":1690,"Ultra Rare":680}}
  ]}'),
  ('pack-sv8pt5', 'Prismatic Evolutions', 250, '["sv8pt5"]', '{"slots": [
    {"count":4,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Common":4645,"Uncommon":3253,"Rare":2101}},
    {"count":1,"weights":{"Common":4299,"Uncommon":3011,"Rare":1944,"ACE SPEC Rare":470,"Special Illustration Rare":220,"Hyper Rare":56}},
    {"count":1,"weights":{"Rare":7690,"Double Rare":1640,"Ultra Rare":750}}
  ]}'),
  ('pack-sv10', 'Destined Rivals', 200, '["sv10"]', '{"slots": [
    {"count":4,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Common":5203,"Uncommon":3715,"Rare":1082}},
    {"count":1,"weights":{"Common":4681,"Uncommon":3342,"Rare":974,"Illustration Rare":830,"Special Illustration Rare":106,"Hyper Rare":67}},
    {"count":1,"weights":{"Rare":7140,"Double Rare":2000,"Ultra Rare":640}}
  ]}'),
  ('pack-me1', 'Mega Evolution', 150, '["me1"]', '{"slots": [
    {"count":4,"weights":{"Common":1}},
    {"count":3,"weights":{"Uncommon":1}},
    {"count":1,"weights":{"Common":5400,"Uncommon":3602,"Rare":999}},
    {"count":1,"weights":{"Common":4742,"Uncommon":3163,"Rare":877,"Illustration Rare":1110,"Special Illustration Rare":99,"Mega Hyper Rare":8}},
    {"count":1,"weights":{"Rare":7140,"Double Rare":2000,"Ultra Rare":830}}
  ]}');

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t.name || ': ' || r.rarity, ', ')
    INTO missing
    FROM new_templates t
    CROSS JOIN LATERAL (
      SELECT DISTINCT k AS rarity
        FROM jsonb_array_elements(t.slot_config -> 'slots') AS s,
             jsonb_object_keys(s -> 'weights') AS k
    ) r
   WHERE NOT EXISTS (
     SELECT 1 FROM cards c
      WHERE c."setId" IN (SELECT jsonb_array_elements_text(t.set_ids)) AND c.rarity = r.rarity
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'No cards in the catalog for: % — run the catalog sync first', missing;
  END IF;
END $$;

INSERT INTO pack_templates (id, name, "setFilter", cost, "slotConfig", active)
SELECT id, name, jsonb_build_object('setIds', set_ids), cost, slot_config, true
  FROM new_templates
ON CONFLICT (id) DO NOTHING;

SELECT id, name, cost, active FROM pack_templates WHERE id LIKE 'pack-%' ORDER BY cost, name;

COMMIT;
