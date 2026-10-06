-- Despacho automático: expediente, rota otimizada, prioridade e falhas.
\set QUIET on
begin;
update companies set store_lat = -23.5500, store_lng = -46.6300, auto_max_stops = 3, auto_max_detour_km = 2,
  feature_delivery_code = false where id = 'aaaaaaaa-0000-0000-0000-000000000000';
-- o1 (o mais antigo) e o2 ficam ao norte, juntos; o3 fica 5 km ao sul; o4 ainda não está pronto.
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status, ready_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'O1', -23.5410, -46.6300, 10, 'ready', now() - interval '20 minutes') returning id as o1 \gset
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status, ready_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'O2', -23.5400, -46.6290, 10, 'ready', now() - interval '5 minutes') returning id as o2 \gset
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status, ready_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'O3', -23.5950, -46.6300, 10, 'ready', now() - interval '10 minutes') returning id as o3 \gset
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'O4', -23.5420, -46.6300, 10, 'received', now() - interval '30 minutes') returning id as o4 \gset

-- ---------- Expediente sem despacho automático ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_shift();
select tests.ok('desligado: motoboy em expediente não recebe saída', (select count(*) from delivery_runs) = 0);

-- ---------- Liga o despacho automático ----------
select tests.as_user('00000000-0000-0000-0000-0000000000e1');
select tests.bloqueado('supervisor não liga o despacho automático', $q$update companies set auto_dispatch = true$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
update companies set auto_dispatch = true where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.ok('ao ligar, motoboy livre recebe saída com o pedido mais antigo e o vizinho, na ordem do trajeto',
  (select string_agg(customer_name, ',' order by stop_sequence) from delivery_orders where courier_id = '00000000-0000-0000-0000-0000000000c1') = 'O1,O2');
select tests.ok('pedido longe do trajeto não entra na mesma saída', (select run_id is null from delivery_orders where id = :'o3'));
select tests.ok('pedido ainda não pronto não sai', (select run_id is null from delivery_orders where id = :'o4'));
select tests.ok('saída marcada como automática', (select auto from delivery_runs where courier_id = '00000000-0000-0000-0000-0000000000c1'));
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy é avisado', (select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000c1' and type = 'new_run') = 1);
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('chamar de novo não duplica saída', auto_dispatch_tick() = 0 and (select count(*) from delivery_runs) = 1);

select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select start_shift();
select tests.ok('outro motoboy entra no expediente e recebe o pedido que sobrou',
  (select courier_id = '00000000-0000-0000-0000-0000000000c2' from delivery_orders where id = :'o3'));

-- ---------- Motoboy que não inicia a saída no prazo ----------
reset role;
update delivery_runs set created_at = now() - interval '10 minutes' where courier_id = '00000000-0000-0000-0000-0000000000c2';
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select auto_dispatch_tick();
select tests.ok('saída não iniciada no prazo volta para a fila', (select run_id is null from delivery_orders where id = :'o3'));
select tests.ok('motoboy que não iniciou fica em pausa', (select paused from courier_shifts where courier_id = '00000000-0000-0000-0000-0000000000c2' and ended_at is null));
select tests.ok('gestor é avisado', (select count(*) from notifications where type = 'auto_timeout' and user_id = '00000000-0000-0000-0000-0000000000a1') = 1);
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select set_shift_paused(false);
select tests.ok('ao voltar a receber, ganha o pedido de novo', (select courier_id = '00000000-0000-0000-0000-0000000000c2' from delivery_orders where id = :'o3'));
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não pausa outro motoboy', $q$select set_shift_paused(true, '00000000-0000-0000-0000-0000000000c2')$q$);

-- ---------- Terminou a saída: recebe a próxima ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
update delivery_orders set status = 'ready' where id = :'o4';
select tests.ok('pedido pronto sem motoboy livre espera', (select run_id is null from delivery_orders where id = :'o4'));
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_run(id) from delivery_runs where courier_id = '00000000-0000-0000-0000-0000000000c1' and status = 'planned';
select complete_delivery(:'o1');
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('no meio da saída não recebe outra', (select run_id is null from delivery_orders where id = :'o4'));
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select complete_delivery(:'o2');
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('ao terminar a saída, recebe o próximo pedido', (select courier_id = '00000000-0000-0000-0000-0000000000c1' from delivery_orders where id = :'o4'));

-- ---------- Encerrar expediente ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select end_shift();
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('encerrar expediente devolve a saída não iniciada', (select run_id is null from delivery_orders where id = :'o3'));
select tests.ok('motoboy fora do expediente não recebe', auto_dispatch_tick() = 0);

-- ---------- Tempo mínimo para juntar pedidos ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
update companies set auto_hold_minutes = 30 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_run(id) from delivery_runs where courier_id = '00000000-0000-0000-0000-0000000000c1' and status = 'planned';
select complete_delivery(:'o4');
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('pedido que espera menos que o tempo mínimo aguarda', (select run_id is null from delivery_orders where id = :'o3'));
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
update companies set auto_hold_minutes = 0, auto_max_stops = 1 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.ok('ao mudar o ajuste, despacha', (select courier_id = '00000000-0000-0000-0000-0000000000c1' from delivery_orders where id = :'o3'));

-- ---------- Outra empresa ----------
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.ok('outra empresa não vê expedientes', (select count(*) from courier_shifts) = 0);
select tests.bloqueado('outra empresa não encerra expediente alheio', format($q$select end_shift(%L)$q$,
  (select id from courier_shifts where courier_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null)));
rollback;
