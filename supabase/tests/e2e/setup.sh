#!/usr/bin/env bash
# Sobe um "Supabase de mentira" local para testar o app no navegador:
# Postgres (banco sistema_e2e com schema + dados de teste), PostgREST e o
# mock de auth. Precisa do binário do PostgREST em $POSTGREST (padrão: postgrest no PATH).
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=sistema_e2e
SECRET=${JWT_SECRET:-segredo-de-teste-local-com-32-caracteres!!}
PSQL="sudo -u postgres psql -X -q -v ON_ERROR_STOP=1"
for f in /tmp/postgrest.pid /tmp/mock-supabase.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; done
sleep 1
sudo -u postgres dropdb --if-exists "$DB" >/dev/null
sudo -u postgres createdb "$DB"
$PSQL -d "$DB" -f supabase/tests/00_stub_supabase.sql >/dev/null 2>&1
$PSQL -d "$DB" -f supabase/tests/01_legado_producao.sql >/dev/null
$PSQL -d "$DB" -f supabase-b2b-schema.sql >/dev/null 2>&1
$PSQL -d "$DB" -f supabase/tests/10_seed.sql >/dev/null
$PSQL -d "$DB" -f supabase/tests/e2e/seed-e2e.sql >/dev/null
$PSQL -d "$DB" -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'auth' noinherit; end if; end \$\$; grant anon, authenticated to authenticator;" >/dev/null
cat > /tmp/postgrest.conf <<CONF
db-uri = "postgres://authenticator:auth@127.0.0.1:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 54322
CONF
nohup ${POSTGREST:-postgrest} /tmp/postgrest.conf > /tmp/postgrest.log 2>&1 & echo $! > /tmp/postgrest.pid
nohup node supabase/tests/e2e/mock-supabase.mjs > /tmp/mock-supabase.log 2>&1 & echo $! > /tmp/mock-supabase.pid
sleep 2
echo "Pronto. Use VITE_SUPABASE_URL=http://localhost:54321 e qualquer VITE_SUPABASE_ANON_KEY."
