-- Pedido local (balcão) x entrega.
\set QUIET on
begin;
update companies set store_lat = -23.55, store_lng = -46.63, feature_delivery_code = true
  where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into products (company_id, name, price) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Misto quente', 19)
  returning id as misto \gset
insert into delivery_zones (company_id, name, fee) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Centro', 5);

-- ---------- Criação ----------
select create_delivery_order(
  jsonb_build_object('order_type', 'local', 'customer_name', '', 'delivery_fee', 7, 'address_neighborhood', 'Centro',
                     'lat', -23.54, 'lng', -46.63, 'payment_method', 'dinheiro'),
  jsonb_build_array(jsonb_build_object('product_id', :'misto'))) as loc \gset
select tests.ok('pedido local sem nome recebe um nome padrão', (select customer_name = 'Cliente no balcão' from delivery_orders where id = :'loc'));
select tests.ok('pedido local não tem endereço, ponto no mapa nem taxa de entrega',
  (select order_type = 'local' and lat is null and address_neighborhood is null and zone_id is null and delivery_fee is null and total = 19
   from delivery_orders where id = :'loc'));
select tests.ok('pedido local não gera código de entrega', not exists (select 1 from order_delivery_codes where order_id = :'loc'));
select tests.bloqueado('entrega exige o nome do cliente',
  format($q$select create_delivery_order('{"customer_name":" "}', jsonb_build_array(jsonb_build_object('product_id', %L)))$q$, :'misto'));
select tests.bloqueado('tipo de pedido inválido é recusado',
  format($q$select create_delivery_order('{"order_type":"x","customer_name":"A"}', jsonb_build_array(jsonb_build_object('product_id', %L)))$q$, :'misto'));
select create_delivery_order(
  jsonb_build_object('customer_name', 'Ana', 'address_neighborhood', 'Centro', 'lat', -23.54, 'lng', -46.63),
  jsonb_build_array(jsonb_build_object('product_id', :'misto'))) as ent \gset
select tests.ok('entrega continua com taxa do bairro e código', (select order_type = 'delivery' and delivery_fee = 5 from delivery_orders where id = :'ent')
  and exists (select 1 from order_delivery_codes where order_id = :'ent'));

-- ---------- Não sai com motoboy ----------
select tests.bloqueado('tipo não muda depois de criado', format($q$update delivery_orders set order_type = 'delivery' where id = %L$q$, :'loc'));
update delivery_orders set delivery_fee = 9 where id = :'loc';
select tests.ok('pedido local continua sem taxa de entrega', (select delivery_fee is null from delivery_orders where id = :'loc'));
select tests.bloqueado('pedido local não é despachado', format($q$select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[%L]::uuid[])$q$, :'loc'));
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'ent']::uuid[]) as run \gset
select tests.bloqueado('pedido local não entra numa saída', format($q$select update_run(%L, array[%L, %L]::uuid[])$q$, :'run', :'ent', :'loc'));
select tests.bloqueado('pedido repetido na lista não passa', format($q$select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[%L, %L]::uuid[])$q$, :'ent', :'ent'));

reset role;
update delivery_runs set status = 'cancelled' where id = :'run';
update delivery_orders set run_id = null, courier_id = null, stop_sequence = null, courier_fee = null where id = :'ent';
update companies set auto_dispatch = true, auto_hold_minutes = 0, auto_dispatch_when = 'any' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_shift();
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('despacho automático ignora o pedido local',
  (select run_id is null from delivery_orders where id = :'loc') and (select run_id is not null from delivery_orders where id = :'ent'));

-- ---------- Concluir no balcão ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não conclui pedido local', format($q$select complete_local_order(%L)$q$, :'loc'));
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.bloqueado('outra empresa não conclui pedido local', format($q$select complete_local_order(%L)$q$, :'loc'));
select tests.as_user('00000000-0000-0000-0000-0000000000e1');
select tests.bloqueado('pedido de entrega não é concluído no balcão', format($q$select complete_local_order(%L)$q$, :'ent'));
select tests.bloqueado('pedido local não vai para entregue sem a função', format($q$update delivery_orders set status = 'delivered' where id = %L$q$, :'loc'));
select complete_local_order(:'loc');
select tests.ok('supervisor conclui o pedido local e o pagamento fica conferido',
  (select status = 'delivered' and delivered_at is not null and payment_received and courier_id is null from delivery_orders where id = :'loc'));
select tests.bloqueado('pedido concluído não é concluído de novo', format($q$select complete_local_order(%L)$q$, :'loc'));

select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('financeiro separa o pedido local dos bairros',
  (select report_financial(current_date - 1, current_date + 1)->'by_neighborhood') @> '[{"key":"Pedido local"}]');
rollback;
