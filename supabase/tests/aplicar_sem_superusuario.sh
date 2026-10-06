#!/usr/bin/env bash
# No Supabase o script roda como "postgres", que NÃO é superusuário: não pode
# alterar objetos de outros donos. Este teste aplica o schema assim, duas
# vezes, num banco à parte. Uso: supabase/tests/aplicar_sem_superusuario.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${DB:-sistema_np}
P="sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d $DB"
sudo -u postgres dropdb --if-exists "$DB" >/dev/null
sudo -u postgres createdb "$DB"
$P -f supabase/tests/00_stub_supabase.sql >/dev/null 2>&1
$P -f supabase/tests/01_legado_producao.sql >/dev/null
$P >/dev/null 2>&1 <<SQL
do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'sbpg') then create role sbpg login createrole bypassrls; end if; end \$\$;
alter role sbpg password 'sbpg';
-- No Supabase as extensões já vêm instaladas.
create extension if not exists pgcrypto;
grant anon, authenticated, service_role to sbpg with admin option;
grant all on schema public to sbpg;
grant usage, create on schema auth, storage to sbpg;
grant all on all tables in schema storage, auth to sbpg;
grant all on all functions in schema auth to sbpg;
do \$\$ declare r record; begin
  for r in select c.oid::regclass t from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('public', 'storage') and c.relkind in ('r', 'S', 'v') loop
    execute format('alter table %s owner to sbpg', r.t);
  end loop;
  -- Funções do próprio projeto ficam com o "postgres" do Supabase; a funcao_legada continua de outro dono.
  for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and pg_get_userbyid(p.proowner) = 'postgres' loop
    execute format('alter function %s owner to sbpg', r.f);
  end loop;
end \$\$;
alter publication supabase_realtime owner to sbpg;
SQL
for i in 1 2; do
  PGPASSWORD=sbpg psql -X -q -h 127.0.0.1 -U sbpg -d "$DB" -v ON_ERROR_STOP=1 -f supabase-b2b-schema.sql >/dev/null 2>&1 \
    || { echo "Erro aplicando o schema sem superusuário (vez $i):"; PGPASSWORD=sbpg psql -X -q -h 127.0.0.1 -U sbpg -d "$DB" -v ON_ERROR_STOP=1 -f supabase-b2b-schema.sql 2>&1 | grep ERROR; exit 1; }
done
echo "schema aplicado 2x sem superusuário"
