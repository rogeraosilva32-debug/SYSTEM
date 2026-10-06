-- Encerrar o expediente no meio da entrega: o que não foi entregue volta
-- para a fila de prontos, o entregue fica com o motoboy e o gestor é avisado.
\set QUIET on
begin;
update companies set auto_dispatch = false, feature_delivery_code = false where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'F1', -23.54, -46.63, 10, 'ready') returning id as f1 \gset
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'F2', -23.55, -46.63, 10, 'ready') returning id as f2 \gset
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'F3', -23.56, -46.63, 10, 'ready') returning id as f3 \gset

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_shift();
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'f1', :'f2', :'f3']::uuid[]) as run \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_run(:'run');
reset role;
update delivery_orders set status = 'delivered', delivered_at = now() where id = :'f1';
update delivery_orders set status = 'problem' where id = :'f3';

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select end_shift();
reset role;
select tests.ok('entrega já feita continua com o motoboy',
  (select status = 'delivered' and courier_id = '00000000-0000-0000-0000-0000000000c1' from delivery_orders where id = :'f1'));
select tests.ok('entrega em rota volta para a fila de prontos',
  (select status = 'ready' and courier_id is null and run_id is null and dispatched_at is null from delivery_orders where id = :'f2'));
select tests.ok('entrega com problema também volta para a fila',
  (select status = 'ready' and courier_id is null from delivery_orders where id = :'f3'));
select tests.ok('saída fica encerrada', (select status = 'finished' and finished_at is not null from delivery_runs where id = :'run'));
select tests.ok('gestor é avisado', exists (select 1 from notifications where type = 'run_released' and user_id = '00000000-0000-0000-0000-0000000000a1'));
select tests.ok('vai para o log do sistema', exists (select 1 from system_log where action = 'run_released'));
select tests.ok('motoboy fica sem saída aberta', not exists (select 1 from delivery_runs where courier_id = '00000000-0000-0000-0000-0000000000c1' and status in ('planned', 'in_progress')));

-- Gestor encerra o expediente de outro motoboy no meio da saída
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select start_shift() as turno \gset
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select dispatch_run('00000000-0000-0000-0000-0000000000c2', array[:'f2']::uuid[]) as run2 \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select start_run(:'run2');
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select end_shift(id) from courier_shifts where courier_id = '00000000-0000-0000-0000-0000000000c2' and ended_at is null;
reset role;
select tests.ok('gestor encerrando: entrega volta para a fila', (select status = 'ready' and courier_id is null from delivery_orders where id = :'f2'));
select tests.ok('saída sem nenhuma entrega feita fica cancelada', (select status = 'cancelled' from delivery_runs where id = :'run2'));

-- Colaborador removido no meio da saída
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select start_shift();
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select dispatch_run('00000000-0000-0000-0000-0000000000c2', array[:'f2']::uuid[]) as run3 \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select start_run(:'run3');
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select remove_collaborator('00000000-0000-0000-0000-0000000000c2');
reset role;
select tests.ok('colaborador removido: entrega volta para a fila', (select status = 'ready' and courier_id is null from delivery_orders where id = :'f2'));
rollback;
