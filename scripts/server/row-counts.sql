-- Every table in public, with an EXACT row count, in one round trip.
--
-- Not pg_stat_user_tables.n_live_tup: that is an estimate maintained by the
-- autovacuum daemon, it is wrong immediately after a restore, and a backup
-- verification built on an estimate would either pass when it should not or
-- fail for no reason. Both are worse than useless in a check that runs
-- unattended every night.
--
-- query_to_xml runs a real `select count(*)` per table inside one statement,
-- so what comes back is the same number a person would get by counting.
select
  table_name,
  (xpath(
    '/row/c/text()',
    query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')
  ))[1]::text::bigint as rows
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;
