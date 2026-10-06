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
$PSQL -d "$DB" -f supabase/tests/01_legado_producao.sql >/dev/null
# Aplica duas vezes: o script precisa poder ser rodado de novo sem erro.
for i in 1 2; do
  $PSQL -d "$DB" -f supabase-b2b-schema.sql >/dev/null 2>&1 || { echo "Erro aplicando o schema (vez $i):"; $PSQL -d "$DB" -f supabase-b2b-schema.sql; exit 1; }
done
# Também como no Supabase, onde "postgres" não é superusuário.
bash supabase/tests/aplicar_sem_superusuario.sh
$PSQL -d "$DB" -f supabase/tests/10_seed.sql >/dev/null
out=""
for f in supabase/tests/[2-9][0-9]_*.sql; do
  # Erro inesperado (fora dos testes) também conta como falha.
  out+=$(sudo -u postgres psql -X -q -d "$DB" -f "$f" 2>&1 | grep -oE '(PASSOU|FALHOU).*|ERROR:.*' | sed -E "s/^ERROR:/FALHOU erro inesperado em $(basename "$f"):/")$'\n'
done
out=$(echo "$out" | grep .)
echo "$out"
total=$(echo "$out" | grep -c . || true); falhas=$(echo "$out" | grep -c '^FALHOU' || true)
echo "---- $((total - falhas))/$total passaram"
[ "$falhas" -eq 0 ]
