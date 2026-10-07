-- Depois da última entrega o motoboy fica "voltando para a loja" até chegar;
-- desvio de rota só conta em saída com rota exata.
\set QUIET on
begin;
update companies set auto_dispatch = false, feature_delivery_code = false, strict_route_mode = false
 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'V1', -23.54, -46.63, 10, 'ready') returning id as v1 \gset
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'V2', -23.55, -46.63, 10, 'ready') returning id as v2 \gset

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_shift();
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'v1']::uuid[]) as run \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_run(:'run');

-- Sem rota exata o desvio não conta nem avisa
select notify_run_off_route(:'run', 900);
reset role;
select tests.ok('sem rota exata: desvio não conta', (select off_route_events = 0 from delivery_runs where id = :'run'));
select tests.ok('sem rota exata: gestor não é avisado', not exists (select 1 from notifications where type = 'off_route'));
update delivery_runs set strict_route = true where id = :'run';
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select notify_run_off_route(:'run', 900);
reset role;
select tests.ok('com rota exata: desvio conta e avisa',
  (select off_route_events = 1 from delivery_runs where id = :'run')
  and exists (select 1 from notifications where type = 'off_route'));

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select complete_delivery(:'v1', null, null, null);
select tests.ok('última entrega: motoboy aparece voltando para a loja',
  exists (select 1 from returning_runs() where run_id = :'run'));
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('gestor também vê quem está voltando', exists (select 1 from returning_runs() where run_id = :'run'));
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.ok('outro motoboy não vê a volta dele', not exists (select 1 from returning_runs() where run_id = :'run'));
select tests.bloqueado('outro motoboy não marca a chegada dele', format('select mark_back_at_store(%L)', :'run'));

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select mark_back_at_store(:'run', 'gps');
reset role;
select tests.ok('chegou na loja: sai da lista', not exists (select 1 from returning_runs() where run_id = :'run'));
select tests.ok('fica registrado como chegada pelo GPS', (select returned_by = 'gps' and returned_at is not null from delivery_runs where id = :'run'));
select tests.ok('chegada vai para o log do sistema', exists (select 1 from system_log where action = 'run_returned'));

-- Nova saída iniciada encerra a volta pendente
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'v2']::uuid[]) as run2 \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_run(:'run2');
select complete_delivery(:'v2', null, null, null);
select tests.ok('segunda saída: voltando de novo', exists (select 1 from returning_runs() where run_id = :'run2'));
select end_shift();
reset role;
select tests.ok('encerrar o expediente encerra a volta', (select returned_by = 'auto' from delivery_runs where id = :'run2'));
rollback;
