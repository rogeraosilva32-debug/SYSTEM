-- Testes do fluxo de entregas (Fase 1). Roda depois de 20_permissoes.sql
-- (usa as funções tests.*). Tudo numa transação, desfeita no final.
\set QUIET on
begin;
insert into delivery_zones (company_id, name, fee) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Centro', 5.00),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'São José', 8.00);

-- ---------- Admin cria pedidos ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into delivery_orders (company_id, customer_name, customer_phone, address_neighborhood, subtotal, status, run_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'Ana', '119', 'centro', 30, 'delivered', null)
  returning id as o1, number as n1, delivery_fee as f1, status as s1 \gset
insert into delivery_orders (company_id, customer_name, address_neighborhood, subtotal)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'Bruno', 'Sao Jose', 20)
  returning id as o2, number as n2, delivery_fee as f2 \gset
insert into delivery_orders (company_id, customer_name, subtotal)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'Carla', 10)
  returning id as o3 \gset
select tests.ok('pedido recebe número sequencial', :n1 = 1 and :n2 = 2);
select tests.ok('taxa do bairro aplicada (ignora acento e maiúscula)', :f1 = 5 and :f2 = 8);
select tests.ok('app não cria pedido já entregue', :'s1' = 'received');
select tests.ok('total = subtotal + taxa', (select total from delivery_orders where id = :'o1') = 35);
select tests.ok('admin vê o código de entrega', (select count(*) from order_delivery_codes where order_id = :'o1') = 1);
select tests.permitido('admin move pedido para "pronto"', format($q$update delivery_orders set status = 'ready' where id = %L$q$, :'o1'));
select tests.bloqueado('admin não marca entregue direto', format($q$update delivery_orders set status = 'delivered' where id = %L$q$, :'o1'));
select tests.bloqueado('admin não coloca pedido em saída direto', format($q$update delivery_orders set courier_id = '00000000-0000-0000-0000-0000000000c1' where id = %L$q$, :'o1'));
select tests.bloqueado('admin não liga o código de entrega (só a plataforma)', $q$update companies set feature_delivery_code = true$q$);
select tests.bloqueado('admin não liga a marca própria (só a plataforma)', $q$update companies set feature_branding = true$q$);
update companies set strict_route_mode = true;
select tests.ok('admin liga o modo rota exata', (select strict_route_mode from companies));

-- ---------- Outros não veem ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy não vê pedidos antes do despacho', (select count(*) from delivery_orders) = 0);
select tests.bloqueado('motoboy não cria pedido', $q$insert into delivery_orders (company_id, customer_name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'X')$q$);
select tests.ok('motoboy não lê códigos de entrega', (select count(*) from order_delivery_codes) = 0);
select tests.bloqueado('motoboy não despacha', format($q$select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[%L]::uuid[])$q$, :'o1'));
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.ok('outra empresa não vê os pedidos', (select count(*) from delivery_orders) = 0);
select tests.as_user('00000000-0000-0000-0000-0000000000e1');
select tests.ok('supervisor vê os pedidos da empresa', (select count(*) from delivery_orders) = 3);
select tests.bloqueado('supervisor não despacha para motoboy fora da equipe', format($q$select dispatch_run('00000000-0000-0000-0000-0000000000c2', array[%L]::uuid[])$q$, :'o3'));

-- ---------- Despacho com várias paradas ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('não despacha para motoboy de outra empresa', format($q$select dispatch_run('00000000-0000-0000-0000-0000000000bc', array[%L]::uuid[])$q$, :'o1'));
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'o2', :'o1']::uuid[]) as run \gset
select tests.ok('saída criada com 2 paradas na ordem escolhida',
  (select array_agg(id order by stop_sequence) from delivery_orders where run_id = :'run') = array[:'o2', :'o1']::uuid[]);
select tests.ok('saída herda o modo rota exata', (select strict_route from delivery_runs where id = :'run'));
select tests.bloqueado('pedido não entra em duas saídas', format($q$select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[%L]::uuid[])$q$, :'o1'));
select tests.bloqueado('pedido em saída não volta de status pela fila', format($q$update delivery_orders set status = 'preparing' where id = %L$q$, :'o1'));

-- ---------- Motoboy ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy vê as paradas dele', (select count(*) from delivery_orders) = 2);
select tests.ok('motoboy recebeu notificação da saída', (select count(*) from notifications where type = 'new_run') = 1);
select tests.bloqueado('motoboy não altera pedido direto', format($q$update delivery_orders set status = 'delivered' where id = %L$q$, :'o1'));
select start_run(:'run');
select tests.ok('iniciar saída põe pedidos em rota', (select count(*) from delivery_orders where status = 'on_route') = 2);
select tests.bloqueado('rota exata: não escolhe rota alternativa', format($q$select choose_route(%L, 1::smallint)$q$, :'o2'));
select tests.permitido('rota exata: rota principal ok', format($q$select choose_route(%L, 0::smallint)$q$, :'o2'));
select notify_run_off_route(:'run', 400);
select notify_run_off_route(:'run', 450);
select tests.ok('sem código de entrega ligado, finaliza sem código', complete_delivery(:'o2') = 'ok');
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.bloqueado('outro motoboy não finaliza', format($q$select complete_delivery(%L)$q$, :'o1'));

-- ---------- Código de entrega ligado pela plataforma ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
update companies set feature_delivery_code = true where id = 'aaaaaaaa-0000-0000-0000-000000000000';
reset role;
select code as cod from order_delivery_codes where order_id = :'o1' \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('código errado é recusado', complete_delivery(:'o1', 'xxxx') = 'wrong_code');
select tests.ok('pedido continua em rota', (select status from delivery_orders where id = :'o1') = 'on_route');
select tests.ok('código certo finaliza', complete_delivery(:'o1', :'cod', -23.5, -46.6) = 'ok');
select tests.ok('entrega registra posição e código', (select delivered_by_code and delivered_lat = -23.5 from delivery_orders where id = :'o1'));
select tests.ok('saída encerra quando todas as paradas terminam', (select status from delivery_runs where id = :'run') = 'finished');

-- ---------- Bloqueio após 5 tentativas, problema e exceção ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'o3']::uuid[]) as run2 \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_run(:'run2');
select complete_delivery(:'o3', '0000x') from generate_series(1, 4);
select tests.ok('5ª tentativa errada bloqueia', complete_delivery(:'o3', '0000x') = 'locked');
reset role;
select code as cod3 from order_delivery_codes where order_id = :'o3' \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('bloqueado: nem o código certo passa', complete_delivery(:'o3', :'cod3') = 'locked');
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('desvio avisa o admin só uma vez a cada 5 min', (select count(*) from notifications where type = 'off_route') = 1);
select tests.ok('admin é avisado do bloqueio', (select count(*) from notifications where type = 'delivery_code_locked') = 1);
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select report_problem(:'o3', 'Cliente não atende');
select tests.ok('problema registrado', (select status from delivery_orders where id = :'o3') = 'problem');
select tests.bloqueado('motoboy não força entrega', format($q$select force_complete_delivery(%L, 'x')$q$, :'o3'));
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('forçar entrega exige motivo', format($q$select force_complete_delivery(%L, '')$q$, :'o3'));
select force_complete_delivery(:'o3', 'Cliente perdeu o código, confirmou por telefone');
select tests.ok('entrega forçada fica na auditoria', (select count(*) from audit_log where action = 'delivery_forced') = 1);

-- ---------- Reorganizar saída (eventualidade) ----------
insert into delivery_orders (company_id, customer_name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'D') returning id as o4 \gset
insert into delivery_orders (company_id, customer_name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'E') returning id as o5 \gset
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'o4', :'o5']::uuid[]) as run3 \gset
select update_run(:'run3', array[:'o5']::uuid[], '00000000-0000-0000-0000-0000000000c2');
select tests.ok('pedido tirado da saída volta para a fila', (select run_id is null and courier_id is null from delivery_orders where id = :'o4'));
select tests.ok('saída trocada de motoboy', (select courier_id from delivery_runs where id = :'run3') = '00000000-0000-0000-0000-0000000000c2');
select tests.ok('parada restante passa ao novo motoboy', (select courier_id from delivery_orders where id = :'o5') = '00000000-0000-0000-0000-0000000000c2');

-- ---------- Histórico de posições ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.permitido('motoboy grava a própria posição', format($q$insert into location_pings (company_id, courier_id, run_id, lat, lng) values ('aaaaaaaa-0000-0000-0000-000000000000', auth.uid(), %L, 1, 2)$q$, :'run'));
insert into location_pings (company_id, courier_id, lat, lng) values ('aaaaaaaa-0000-0000-0000-000000000000', auth.uid(), 1, 2);
select tests.bloqueado('motoboy não grava posição de outro', $q$insert into location_pings (company_id, courier_id, lat, lng) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', 1, 2)$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.ok('motoboy não vê posição de outro', (select count(*) from location_pings) = 0);
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('admin vê o histórico de posições', (select count(*) from location_pings) = 1);

select tests.ok('fim da suíte de entregas (nenhum erro inesperado antes)', true);
rollback;

-- A tabela "orders" do app antigo continua intacta.
reset role;
select tests.ok('tabela orders antiga intacta', (select count(*) from public.orders where status = 'legado') = 1
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'company_id'));
