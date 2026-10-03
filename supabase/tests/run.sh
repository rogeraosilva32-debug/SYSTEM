#!/usr/bin/env bash
# Cria um banco descartável, aplica o schema e roda os testes de permissão.
# Uso: supabase/tests/run.sh   (precisa de um Postgres local; sudo -u postgres)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${DB:-sistema_teste}
PSQL="sudo -u postgres psql -X -q -v ON_ERROR_STOP=1"
sudo -u postgres dropdb --if-exists "$DB" >/dev/null
sudo -u postgres createdb "$DB"
$PSQL -d "$DB" -f supabase/tests/00_stub_supabase.sql >/dev/null
$PSQL -d "$DB" -f supabase-b2b-schema.sql >/dev/null 2>&1 || { echo "Erro aplicando o schema:"; $PSQL -d "$DB" -f supabase-b2b-schema.sql; exit 1; }
$PSQL -d "$DB" -f supabase/tests/10_seed.sql >/dev/null
out=$(sudo -u postgres psql -X -q -d "$DB" -f supabase/tests/20_permissoes.sql 2>&1 | grep -oE '(PASSOU|FALHOU).*')
echo "$out"
total=$(echo "$out" | grep -c . || true); falhas=$(echo "$out" | grep -c '^FALHOU' || true)
echo "---- $((total - falhas))/$total passaram"
[ "$falhas" -eq 0 ]
