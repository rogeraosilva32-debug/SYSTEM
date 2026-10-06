-- Modo cozinha: fila de preparo por login de gestor ou pelo link da tela.
\set QUIET on
begin;
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into products (company_id, name, price) values ('aaaaaaaa-0000-0000-0000-000000000000', 'X-Bacon', 20)
  returning id as xb \gset
insert into products (company_id, kind, name, price) values ('aaaaaaaa-0000-0000-0000-000000000000', 'addon', 'Cheddar', 4)
  returning id as ched \gset
select create_delivery_order(
  jsonb_build_object('order_type', 'local', 'customer_name', 'Mesa 2', 'customer_phone', '11999990000', 'notes', 'sem pressa'),
  jsonb_build_array(jsonb_build_object('product_id', :'xb', 'quantity', 2, 'addon_ids', jsonb_build_array(:'ched'), 'notes', 'sem cebola'))) as o1 \gset

select tests.ok('gestor vê a fila de preparo com itens e adicionais',
  (select kitchen_board()->'orders'->0->'items'->0 = '{"name":"X-Bacon","variant":null,"quantity":2,"notes":"sem cebola","addons":["Cheddar"]}'::jsonb));
select tests.ok('fila da cozinha não traz telefone nem valores',
  (select not (kitchen_board()->'orders'->0 ? 'customer_phone') and not (kitchen_board()->'orders'->0 ? 'total')));

-- ---------- Link da tela ----------
select kitchen_display_token() as tok \gset
select tests.ok('link é longo (não dá para adivinhar)', length(:'tok') >= 64);
select tests.ok('pedir de novo devolve o mesmo link', kitchen_display_token() = :'tok');
select tests.as_user('00000000-0000-0000-0000-0000000000e1');
select tests.bloqueado('supervisor não gera o link', $q$select kitchen_display_token()$q$);
select tests.ok('supervisor abre a cozinha logado', jsonb_array_length(kitchen_board()->'orders') = 1);
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não abre a cozinha', $q$select kitchen_board()$q$);
select tests.ok('motoboy não lê o link', (select count(*) from kitchen_displays) = 0);
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.ok('outra empresa não vê a fila de outra', jsonb_array_length(kitchen_board()->'orders') = 0);
select tests.bloqueado('outra empresa não avança pedido alheio', format($q$select kitchen_advance(%L)$q$, :'o1'));

select tests.as_user(null);
select tests.ok('tela da cozinha abre só com o link', jsonb_array_length(kitchen_board(:'tok')->'orders') = 1);
select tests.bloqueado('sem link não abre', $q$select kitchen_board()$q$);
select tests.bloqueado('link errado não abre', $q$select kitchen_board(repeat('a', 64))$q$);
select tests.bloqueado('anônimo não lê pedidos direto', $q$select 1/(select count(*) from delivery_orders)$q$);
select tests.ok('cozinha inicia o preparo', kitchen_advance(:'o1', :'tok') = 'preparing');
select tests.ok('cozinha marca pronto', kitchen_advance(:'o1', :'tok') = 'ready');
select tests.bloqueado('pronto não avança mais', format($q$select kitchen_advance(%L, %L)$q$, :'o1', :'tok'));
select tests.ok('pronto sai da fila e aparece nos prontos',
  jsonb_array_length(kitchen_board(:'tok')->'orders') = 0 and kitchen_board(:'tok')->'ready'->0->>'customer_name' = 'Mesa 2');

select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select kitchen_display_token(true) as tok2 \gset
select tests.as_user(null);
select tests.bloqueado('trocar o link derruba o antigo', format($q$select kitchen_board(%L)$q$, :'tok'));
select tests.ok('link novo funciona', kitchen_board(:'tok2') ? 'orders');
rollback;
