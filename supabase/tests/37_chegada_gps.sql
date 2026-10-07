-- Chegada na loja automática: posição do motoboy perto da loja encerra a volta.
\set QUIET on
begin;
update companies set auto_dispatch = false, feature_delivery_code = false, store_lat = -23.5505, store_lng = -46.6333
 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'G1', -23.54, -46.63, 10, 'ready') returning id as g1 \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_shift();
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'g1']::uuid[]) as run \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_run(:'run');
select complete_delivery(:'g1', null, null, null);
insert into location_pings (company_id, courier_id, lat, lng) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', -23.60, -46.70);
-- Com outra saída para fazer, passar em frente à loja não conta como chegada.
reset role;
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'G2', -23.53, -46.62, 10, 'ready') returning id as g2 \gset
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'g2']::uuid[]) as run2 \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
insert into location_pings (company_id, courier_id, lat, lng) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', -23.5508, -46.6335);
select mark_back_at_store(:'run', 'gps');
reset role;
select tests.ok('com entrega pendente: GPS perto da loja não marca chegada',
  (select returned_at is null from delivery_runs where id = :'run'));
update delivery_runs set status = 'cancelled', finished_at = now() where id = :'run2';
update delivery_orders set run_id = null, courier_id = null where id = :'g2';
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
insert into location_pings (company_id, courier_id, lat, lng) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', -23.60, -46.70);
reset role;
select tests.ok('longe da loja: continua voltando', exists (select 1 from returning_runs() where run_id = :'run'));
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
insert into location_pings (company_id, courier_id, lat, lng) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', -23.5508, -46.6335);
reset role;
select tests.ok('perto da loja: chegada marcada sozinha pelo GPS',
  (select returned_by = 'gps' and returned_at is not null from delivery_runs where id = :'run'));
rollback;
