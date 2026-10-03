# Teste do app no navegador (sem Supabase)

Sobe um "Supabase de mentira" local (Postgres + PostgREST + login falso,
qualquer senha com 6+ caracteres) e roda o fluxo de entregas no Chromium:
admin cria pedido, despacha 2 paradas, motoboy escolhe rota, erra e acerta
o código, sai do trajeto; admin vê o mapa e liga o modo rota exata.
Mapas, OSRM e Nominatim são simulados.

```bash
# PostgREST: baixe o binário em github.com/PostgREST/postgrest/releases
POSTGREST=/caminho/postgrest supabase/tests/e2e/setup.sh
printf 'VITE_SUPABASE_URL=http://localhost:54321\nVITE_SUPABASE_ANON_KEY=teste\n' > .env
npm run build && npx vite preview --port 4173 &
node supabase/tests/e2e/fluxo-entregas.mjs   # precisa do pacote playwright
```

Usuários de teste: `a1@t` (admin), `c1@t` e `c2@t` (motoboys), `s1@t`
(supervisor), `p@t` (plataforma), `b1@t` (admin de outra empresa).
