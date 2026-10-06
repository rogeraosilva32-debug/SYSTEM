-- Gestor edita a saída automática antes de o motoboy confirmar: troca de
-- motoboy, remove/reordena paradas e o despacho automático não desfaz.
\set QUIET on
begin;
update companies set store_lat = -23.5500, store_lng = -46.6300, auto_max_stops = 3, auto_max_detour_km = 0,
  auto_accept_minutes = 5, feature_delivery_code = false, auto_dispatch = true where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status, ready_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'E1', -23.5410, -46.6300, 10, 'ready', now() - interval '9 minutes') returning id as e1 \gset
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status, ready_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'E2', -23.5400, -46.6290, 10, 'ready', now() - interval '8 minutes') returning id as e2 \gset
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status, ready_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'E3', -23.5600, -46.6400, 10, 'ready', now() - interval '7 minutes') returning id as e3 \gset

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_shift();
select id as run from delivery_runs where courier_id = '00000000-0000-0000-0000-0000000000c1' and status = 'planned' \gset
select tests.ok('motoboy 1 recebe a saída com os 3', (select count(*) from delivery_orders where run_id = :'run') = 3);
reset role;
update delivery_runs set created_at = now() - interval '4 minutes' where id = :'run';

-- ---------- Trocar de motoboy ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('não passa para motoboy de outra empresa',
  format($q$select update_run(%L, array[%L, %L, %L]::uuid[], '00000000-0000-0000-0000-0000000000bc')$q$, :'run', :'e1', :'e2', :'e3'));
select tests.bloqueado('não repete pedido na saída',
  format($q$select update_run(%L, array[%L, %L]::uuid[])$q$, :'run', :'e1', :'e1'));
select update_run(:'run', array[:'e2', :'e1', :'e3']::uuid[], '00000000-0000-0000-0000-0000000000c2');
select tests.ok('saída passa para o motoboy 2', (select courier_id = '00000000-0000-0000-0000-0000000000c2' from delivery_runs where id = :'run'));
select tests.ok('pedidos vão junto, na ordem nova',
  (select string_agg(customer_name, ',' order by stop_sequence) from delivery_orders where run_id = :'run') = 'E2,E1,E3'
  and (select bool_and(courier_id = '00000000-0000-0000-0000-0000000000c2' and status = 'ready') from delivery_orders where run_id = :'run'));
select tests.ok('novo motoboy ganha o prazo inteiro', (select created_at = now() from delivery_runs where id = :'run'));
reset role;
select tests.ok('motoboy antigo é avisado', (select count(*) from notifications where type = 'run_reassigned' and user_id = '00000000-0000-0000-0000-0000000000c1') = 1);
select tests.ok('motoboy novo é avisado', (select count(*) from notifications where type = 'new_run' and user_id = '00000000-0000-0000-0000-0000000000c2') = 1);
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy antigo não confirma mais a saída', format($q$select start_run(%L)$q$, :'run'));
select tests.ok('motoboy antigo não vê mais os pedidos', (select count(*) from delivery_orders where run_id = :'run') = 0);

-- ---------- Tirar parada: não volta sozinha para a mesma saída ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select update_run(:'run', array[:'e2', :'e1']::uuid[]);
select tests.ok('pedido tirado volta para a fila e não para a saída editada',
  (select run_id is distinct from :'run'::uuid from delivery_orders where id = :'e3'));
select tests.ok('saída editada fica travada para o automático', (select locked from delivery_runs where id = :'run'));
select tests.ok('pedido tirado vai para o motoboy livre', (select courier_id = '00000000-0000-0000-0000-0000000000c1' from delivery_orders where id = :'e3'));

-- ---------- Motoboy ocupado ----------
select id as run2 from delivery_runs where courier_id = '00000000-0000-0000-0000-0000000000c1' and status = 'planned' \gset
select tests.bloqueado('não passa para motoboy que já está com outra saída',
  format($q$select update_run(%L, array[%L, %L]::uuid[], '00000000-0000-0000-0000-0000000000c1')$q$, :'run', :'e2', :'e1'));

-- ---------- Motoboy novo confirma ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select start_run(:'run');
select tests.ok('motoboy novo confirma e os pedidos vão em rota', (select bool_and(status = 'on_route') from delivery_orders where run_id = :'run'));
select tests.as_user('00000000-0000-0000-0000-0000000000e1');
select tests.bloqueado('supervisor só passa para motoboy da equipe dele',
  format($q$select update_run(%L, array[%L]::uuid[], '00000000-0000-0000-0000-0000000000c2')$q$, :'run2', :'e3'));
rollback;
