-- Cardápio, pedido com produtos e taxa do motoboy no total.
\set QUIET on
begin;
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into product_categories (company_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Lanches')
  returning id as cat \gset
insert into products (company_id, category_id, name, variants) values
  ('aaaaaaaa-0000-0000-0000-000000000000', :'cat', 'X-Tudo', '[{"name":"Hambúrguer","price":26},{"name":"Frango ou lombo","price":29.5}]')
  returning id as xtudo, price as xtudo_min \gset
insert into products (company_id, category_id, name, price) values
  ('aaaaaaaa-0000-0000-0000-000000000000', :'cat', 'Misto quente', 19)
  returning id as misto \gset
insert into products (company_id, kind, name, price) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'addon', 'Bacon', 5)
  returning id as bacon \gset
select tests.ok('preço "a partir de" = menor opção', :xtudo_min = 26);
select tests.bloqueado('opção sem preço é recusada', format($q$update products set variants = '[{"name":"X"}]' where id = %L$q$, :'xtudo'));
select tests.bloqueado('adicional não tem opções', format($q$update products set variants = '[{"name":"X","price":1}]' where id = %L$q$, :'bacon'));

select tests.as_user('00000000-0000-0000-0000-0000000000e1');
select tests.ok('supervisor lê o cardápio', (select count(*) from products) = 3);
select tests.bloqueado('supervisor não altera o cardápio', format($q$update products set price = 1 where id = %L$q$, :'misto'));
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy não lê o cardápio', (select count(*) from products) = 0);
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.ok('outra empresa não lê o cardápio', (select count(*) from products) = 0);
select tests.bloqueado('outra empresa não altera o cardápio', format($q$insert into products (company_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Y')$q$));

-- ---------- Pedido com produtos ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select create_delivery_order(
  jsonb_build_object('customer_name', 'Ana', 'payment_method', 'dinheiro', 'delivery_fee', 5, 'subtotal', 1),
  jsonb_build_array(
    jsonb_build_object('product_id', :'xtudo', 'variant', 'Frango ou lombo', 'addon_ids', jsonb_build_array(:'bacon'), 'quantity', 2, 'notes', 'sem milho'),
    jsonb_build_object('product_id', :'misto'))) as ord \gset
select tests.ok('valor dos itens vem do cardápio (2 × 34,50 + 19)', (select subtotal from delivery_orders where id = :'ord') = 88);
select tests.ok('total = itens + taxa de entrega', (select total from delivery_orders where id = :'ord') = 93);
select tests.ok('texto dos itens preenchido', (select items from delivery_orders where id = :'ord') = E'2x X-Tudo (Frango ou lombo) + Bacon · sem milho\n1x Misto quente');
select tests.bloqueado('valor dos itens não é editado à mão', format($q$update delivery_orders set subtotal = 1 where id = %L$q$, :'ord'));
select tests.bloqueado('produto com opções exige a opção', format($q$select create_delivery_order('{"customer_name":"B"}', jsonb_build_array(jsonb_build_object('product_id', %L)))$q$, :'xtudo'));
select tests.bloqueado('pedido sem produtos é recusado', $q$select create_delivery_order('{"customer_name":"B"}', '[]')$q$);
update products set active = false where id = :'misto';
select tests.bloqueado('produto inativo não entra no pedido', format($q$select create_delivery_order('{"customer_name":"B"}', jsonb_build_array(jsonb_build_object('product_id', %L)))$q$, :'misto'));
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.bloqueado('outra empresa não muda itens do pedido', format($q$select set_order_items(%L, jsonb_build_array(jsonb_build_object('product_id', %L, 'variant', 'Hambúrguer')))$q$, :'ord', :'xtudo'));
select tests.bloqueado('outra empresa não usa produto alheio', format($q$select create_delivery_order('{"customer_name":"B"}', jsonb_build_array(jsonb_build_object('product_id', %L, 'variant', 'Hambúrguer')))$q$, :'xtudo'));

-- ---------- Taxa do motoboy ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
update companies set courier_per_delivery = 4 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into courier_rates (courier_id, company_id, per_delivery) values ('00000000-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000000', 6);
select tests.ok('tela de despacho vê a taxa de cada motoboy',
  (select fee from my_courier_fees() where courier_id = '00000000-0000-0000-0000-0000000000c1') = 4
  and (select fee from my_courier_fees() where courier_id = '00000000-0000-0000-0000-0000000000c2') = 6);
select tests.bloqueado('taxa do motoboy não é editada à mão', format($q$update delivery_orders set courier_fee = 1 where id = %L$q$, :'ord'));
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'ord']::uuid[]) as run \gset
select tests.ok('ao despachar, taxa do motoboy soma no total', (select courier_fee = 4 and total = 97 from delivery_orders where id = :'ord'));
select update_run(:'run', array[:'ord']::uuid[], '00000000-0000-0000-0000-0000000000c2');
select tests.ok('trocar o motoboy usa a taxa dele', (select courier_fee = 6 and total = 99 from delivery_orders where id = :'ord'));
select tests.bloqueado('itens não mudam depois do despacho', format($q$select set_order_items(%L, jsonb_build_array(jsonb_build_object('product_id', %L, 'variant', 'Hambúrguer')))$q$, :'ord', :'xtudo'));
select update_run(:'run', array[]::uuid[]);
select tests.ok('pedido tirado da saída perde a taxa do motoboy', (select courier_fee is null and total = 93 from delivery_orders where id = :'ord'));
update companies set courier_fee_on_order = false where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'ord']::uuid[]) as run2 \gset
select tests.ok('empresa pode desligar a taxa do motoboy no total', (select courier_fee is null and total = 93 from delivery_orders where id = :'ord'));
rollback;
