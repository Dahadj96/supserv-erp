-- Screen 82. TOUATGAZ / Touat Gaz / TouatGaz JV / GTG must all find one record,
-- or half of search is useless.
--
-- Two problems to solve at once:
--   1. Accents. "Société" typed as "societe" must match. `unaccent` does that,
--      but Postgres marks it STABLE, not IMMUTABLE, because a dictionary can be
--      reloaded — so it cannot appear in an index expression. The wrapper below
--      is the standard workaround: same function, promised immutable. If the
--      unaccent dictionary is ever edited, these indexes must be REINDEXed.
--   2. Spelling. Trigram similarity handles "Touat Gaz" vs "TouatGaz", and
--      GIN + gin_trgm_ops makes it fast enough to type into.

CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_legal_name_trgm
  ON party USING gin (immutable_unaccent(lower(legal_name)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_trade_name_trgm
  ON party USING gin (immutable_unaccent(lower(coalesce(trade_name, ''))) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_alias_trgm
  ON party_alias USING gin (immutable_unaccent(lower(alias)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS person_full_name_trgm
  ON person USING gin (immutable_unaccent(lower(full_name)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_designation_trgm
  ON item USING gin (immutable_unaccent(lower(designation)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_alias_trgm
  ON item_alias USING gin (immutable_unaccent(lower(alias)) gin_trgm_ops);
--> statement-breakpoint
-- Exact-code lookups stay exact: a person typing ENQ-2026-0141 wants that row,
-- not something 82% similar to it.
CREATE INDEX IF NOT EXISTS party_code_lower ON party (lower(code));
