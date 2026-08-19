-- fuzzy matching for company aliases: "Touat Gaz" ~ "TOUATGAZ"
create extension if not exists pg_trgm;
-- "société" = "societe"
create extension if not exists unaccent;
-- case-insensitive email and reference columns
create extension if not exists citext;
