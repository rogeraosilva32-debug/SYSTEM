-- Limite de expediente parado: motoboy sem ação além do limite é pausado
-- (ou tem o expediente encerrado); na loja (GPS) não conta como parado;
-- em saída o gestor só é avisado.
\set QUIET on
begin;
update companies set auto_dispatch = false, feature_delivery_code = false, shift_idle_minutes = 0,
       store_lat = -23.5505, store_lng = -46.6333
 where id = 'aaaaaaaa-0000-0000-0000-000000000000';

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_shift();
reset role;
update courier_shifts set started_at = now() - interval '2 hours' where courier_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null;
select tests.ok('limite desligado: ninguém é pausado', shift_idle_check('aaaaaaaa-0000-0000-0000-000000000000') = 0);

update companies set shift_idle_minutes = 60 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
-- Na loja (GPS perto) não é parado
insert into location_pings (company_id, courier_id, lat, lng) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', -23.5506, -46.6334);
select tests.ok('esperando na loja não conta como parado', shift_idle_check('aaaaaaaa-0000-0000-0000-000000000000') = 0);
delete from location_pings where courier_id = '00000000-0000-0000-0000-0000000000c1';
insert into location_pings (company_id, courier_id, lat, lng) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', -23.60, -46.70);

-- O próprio tick do motoboy confere o limite
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select auto_dispatch_tick();
reset role;
select tests.ok('longe da loja e sem ação: pausado',
  (select paused and paused_reason = 'Sem atividade' from courier_shifts where courier_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null));
select tests.ok('gestor é avisado', exists (select 1 from notifications where type = 'shift_idle' and user_id = '00000000-0000-0000-0000-0000000000a1'));
select tests.ok('motoboy é avisado', exists (select 1 from notifications where type = 'shift_idle' and user_id = '00000000-0000-0000-0000-0000000000c1'));
select tests.ok('vai para o log do sistema', exists (select 1 from system_log where action = 'shift_idle_paused'));

-- Voltar a receber conta como ação
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select set_shift_paused(false);
reset role;
select tests.ok('voltou da pausa: não é pausado de novo', shift_idle_check('aaaaaaaa-0000-0000-0000-000000000000') = 0);

-- Em saída: só avisa o gestor, uma vez
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'P1', -23.54, -46.63, 10, 'ready') returning id as p1 \gset
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'p1']::uuid[]) as run \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_run(:'run');
reset role;
update delivery_runs set started_at = now() - interval '2 hours' where id = :'run';
update courier_shifts set resumed_at = now() - interval '2 hours' where courier_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null;
delete from notifications;
select shift_idle_check('aaaaaaaa-0000-0000-0000-000000000000');
select shift_idle_check('aaaaaaaa-0000-0000-0000-000000000000');
select tests.ok('em saída não pausa', (select not paused from courier_shifts where courier_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null));
select tests.ok('em saída avisa o gestor uma vez só',
  (select count(*) = 1 from notifications where type = 'shift_idle' and user_id = '00000000-0000-0000-0000-0000000000a1'));

-- Não voltou para a loja depois da última entrega: encerra (opção da empresa)
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select complete_delivery(:'p1', null, null, null);
reset role;
update delivery_runs set finished_at = now() - interval '70 minutes', started_at = now() - interval '2 hours' where id = :'run';
update delivery_orders set delivered_at = now() - interval '70 minutes' where id = :'p1';
update companies set shift_idle_action = 'end' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select shift_idle_check('aaaaaaaa-0000-0000-0000-000000000000');
select tests.ok('não voltou para pegar entregas: expediente encerrado',
  not exists (select 1 from courier_shifts where courier_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null));
select tests.ok('log diz que foi o sistema', exists (select 1 from system_log where message like '%encerrado pelo sistema%'));
select tests.ok('volta pendente é encerrada', (select returned_by = 'auto' from delivery_runs where id = :'run'));

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não chama a conferência direto', 'select shift_idle_check(''aaaaaaaa-0000-0000-0000-000000000000'')');
rollback;
