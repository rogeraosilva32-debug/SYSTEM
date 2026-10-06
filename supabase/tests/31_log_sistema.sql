-- Log do sistema: o que acontece fica registrado, só a plataforma lê.
\set QUIET on
begin;
select set_config('request.headers', '{"x-forwarded-for": "200.1.2.3, 10.0.0.1", "user-agent": "Teste/1.0"}', true);
reset role;
update companies set store_lat = -23.55, store_lng = -46.63, feature_delivery_code = false where id = 'aaaaaaaa-0000-0000-0000-000000000000';
delete from system_log;

-- ---------- Ajustes da empresa ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
update companies set auto_max_stops = 4, off_route_meters = 300 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
update companies set auto_max_stops = 4 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
reset role;
select tests.ok('mudança de ajuste fica no log com o antes e o depois',
  (select changes -> 'auto_max_stops' = '[3, 4, "máximo de entregas por saída"]'::jsonb and changes -> 'off_route_meters' -> 1 = '300' from system_log where action = 'settings_changed'));
select tests.ok('ajuste salvo sem mudança não gera linha', (select count(*) from system_log where action = 'settings_changed') = 1);
select tests.ok('log mostra quem mudou, cargo, empresa, IP e aparelho',
  (select actor_name = 'A1' and actor_role = 'gestor' and company_name = 'Empresa A' and ip = '200.1.2.3' and user_agent = 'Teste/1.0'
     from system_log where action = 'settings_changed'));
select tests.ok('mensagem com o nome dos campos', (select message like 'Ajustes alterados: %máximo de entregas por saída%' from system_log where action = 'settings_changed'));

select tests.as_user('00000000-0000-0000-0000-0000000000a0');
update companies set collaborator_invite_code = 'INV-NOVO' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
reset role;
select tests.ok('código secreto aparece como alterado, sem o valor',
  (select changes -> 'collaborator_invite_code' = '["••••", "••••", "código de convite"]'::jsonb from system_log where message like '%código de convite%')
  and not exists (select 1 from system_log where changes::text like '%INV-NOVO%' or details::text like '%INV-NOVO%'));

-- ---------- Pedido do começo ao fim ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into delivery_orders (company_id, customer_name, customer_phone, address_street, address_number, lat, lng, subtotal, status)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'Joana', '11988887777', 'Rua A', '10', -23.54, -46.63, 30, 'received') returning id as o1, number as n1 \gset
update delivery_orders set status = 'ready' where id = :'o1';
select dispatch_run('00000000-0000-0000-0000-0000000000c1', array[:'o1']::uuid[]) as r1 \gset
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_run(:'r1');
reset role;
select tests.ok('pedido criado com cliente, telefone, valor e endereço',
  (select message = 'Pedido #' || :n1 || ' de Joana (11988887777) criado: entrega, R$ 30,00, Rua A 10' from system_log where action = 'order_created' and entity_id = :'o1'));
select tests.ok('mudança de status do pedido', exists (select 1 from system_log where entity_id = :'o1' and message like '%: recebido → pronto'));
select tests.ok('saída criada para o motoboy', exists (select 1 from system_log where action = 'run_created' and message = 'Saída criada para C1'));
select tests.ok('motoboy confirmou a saída, com o nome dele', exists (select 1 from system_log where action = 'run_status' and message = 'C1 confirmou a saída para entrega' and actor_name = 'C1' and actor_role = 'motoboy'));
select tests.ok('pedido em rota com o motoboy', exists (select 1 from system_log where entity_id = :'o1' and message like '%pronto → em rota com C1'));
select tests.ok('tópicos certos', (select count(distinct topic) = 2 from system_log where entity in ('delivery_orders', 'delivery_runs')));

select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into delivery_orders (company_id, customer_name, subtotal, status) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Caio', 5, 'received') returning id as o2 \gset
update delivery_orders set status = 'cancelled' where id = :'o2';
reset role;
select tests.ok('cancelamento vira aviso', (select level = 'warning' from system_log where entity_id = :'o2' and action = 'order_status'));

-- ---------- Expediente ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select start_shift();
select set_shift_paused(true);
select set_shift_paused(false);
select end_shift();
reset role;
select tests.ok('expediente: início, pausa com motivo, volta e fim',
  (select string_agg(message, ' | ' order by id) from system_log where topic = 'expediente')
  = 'C2 iniciou o expediente | C2 pausou | C2 voltou da pausa | C2 encerrou o expediente');

-- ---------- Despacho automático aparece como sistema ----------
update companies set auto_dispatch = true, auto_max_stops = 3 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select start_shift();
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Auto', -23.54, -46.63, 10, 'received') returning id as o3 \gset
update delivery_orders set status = 'ready' where id = :'o3';
reset role;
select tests.ok('saída do despacho automático aparece como "Despacho automático"',
  (select actor_name = 'Despacho automático' and actor_role = 'sistema' and message like '%pelo despacho automático'
     from system_log where action = 'run_created' and message like '%C2%'));

-- ---------- Cozinha sem login ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select kitchen_display_token() as tok \gset
insert into delivery_orders (company_id, order_type, customer_name, subtotal, status) values ('aaaaaaaa-0000-0000-0000-000000000000', 'local', 'Mesa 1', 5, 'received') returning id as o4 \gset
select tests.as_user(null);
select kitchen_advance(:'o4', :'tok');
reset role;
select tests.ok('avanço pela tela da cozinha aparece como "Tela da cozinha"',
  (select actor_name = 'Tela da cozinha' and actor_role = 'cozinha' from system_log where entity_id = :'o4' and action = 'order_status'));

-- ---------- Eventos do app ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select log_client_event('rede', 'connection_restored', 'Internet voltou depois de 2 min sem conexão', 'warning', '{"segundos": 120}');
select log_client_event('conta', 'logout', 'texto do app é trocado');
select log_client_event('erro', 'acao_inventada', 'Empresa X apagada', 'error');
select log_client_event('xyz', 'qualquer', 'tópico inválido');
select log_client_event('segurança', 'login_failed', 'logado não grava falha de login');
reset role;
select tests.ok('queda de conexão gravada com motoboy e empresa',
  (select actor_name = 'C1' and company_name = 'Empresa A' and level = 'warning' and source = 'app' from system_log where action = 'connection_restored'));
select tests.ok('ação de conta tem a frase do servidor', (select message = 'Saiu do sistema' from system_log where action = 'logout'));
select tests.ok('ação desconhecida não grava', not exists (select 1 from system_log where action = 'acao_inventada'));
select tests.ok('tópico inválido é ignorado', not exists (select 1 from system_log where action = 'qualquer'));
select tests.ok('logado não grava "login falhou"', not exists (select 1 from system_log where action = 'login_failed'));

select tests.as_user(null);
select log_client_event('segurança', 'login_failed', 'texto do cliente é trocado', 'info', '{"email": "x@y.com", "erro": "Invalid login credentials"}');
select log_client_event('rede', 'connection_restored', 'visitante sem link não grava');
select log_client_event('rede', 'connection_restored', 'Cozinha voltou', 'info', '{}', :'tok');
select log_client_event('rede', 'connection_restored', 'link errado', 'info', '{}', repeat('a', 64));
reset role;
select tests.ok('login falho sem login fica registrado com e-mail e IP',
  (select message = 'Tentativa de login sem sucesso para x@y.com' and level = 'warning' and ip = '200.1.2.3' and actor_role = 'visitante'
     from system_log where action = 'login_failed'));
select tests.ok('visitante sem link não grava evento', not exists (select 1 from system_log where message = 'visitante sem link não grava'));
select tests.ok('tela da cozinha grava evento pelo link', (select company_name = 'Empresa A' and actor_name = 'Tela da cozinha' from system_log where message = 'Cozinha voltou'));
select tests.ok('link errado da cozinha não grava', not exists (select 1 from system_log where message = 'link errado'));

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select count(*) from (select log_client_event('erro', 'js_error', 'x') from generate_series(1, 50)) s \gset
reset role;
select tests.ok('limite de 30 eventos por minuto por pessoa',
  (select count(*) from system_log where actor_id = '00000000-0000-0000-0000-0000000000c1' and source = 'app') = 30);

select tests.as_user('00000000-0000-0000-0000-0000000000ff');
select log_client_event('erro', 'js_error', 'conta sem empresa', 'error');
reset role;
select tests.ok('conta sem empresa não escreve erro no log', not exists (select 1 from system_log where message = 'conta sem empresa'));

-- Visitante trocando o IP a cada chamada esbarra no teto geral.
select tests.as_user(null);
select count(*) from (select set_config('request.headers', format('{"x-forwarded-for": "9.9.%s.%s"}', g / 250, g % 250), true),
                             log_client_event('segurança', 'login_failed', '', 'info', '{"email": "z@z"}') from generate_series(1, 400) g) s \gset
select set_config('request.headers', '{"x-forwarded-for": "200.1.2.3, 10.0.0.1", "user-agent": "Teste/1.0"}', true);
reset role;
select tests.ok('visitante trocando de IP para no teto de 300 por minuto',
  (select count(*) from system_log where actor_id is null and source = 'app' and created_at > now() - interval '1 minute') = 300);

-- ---------- Apagar em cascata ----------
reset role;
insert into companies (id, name, license_key, collaborator_invite_code) values ('cccccccc-0000-0000-0000-000000000000', 'Empresa C', 'LIC-C', 'INV-C');
insert into delivery_orders (company_id, customer_name, subtotal) select 'cccccccc-0000-0000-0000-000000000000', 'X' || g, 1 from generate_series(1, 5) g;
delete from companies where id = 'cccccccc-0000-0000-0000-000000000000';
select tests.ok('empresa apagada gera uma linha, não uma por pedido',
  (select count(*) from system_log where action = 'company_deleted') = 1
  and (select count(*) from system_log where action = 'order_deleted') = 0);

-- ---------- Ordem: ação antes do despacho que ela dispara ----------
select tests.ok('pedido pronto aparece antes da saída automática que ele gerou',
  (select id from system_log where entity_id = :'o3' and message like '%recebido → pronto')
  < (select id from system_log where action = 'run_created' and message like '%C2%'));

-- ---------- Quem lê ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('gestor da empresa não lê o log da plataforma', (select count(*) from system_log) = 0);
select tests.bloqueado('gestor não chama a leitura da plataforma', $q$select platform_system_log()$q$);
select tests.bloqueado('ninguém grava direto no log', $q$insert into system_log (topic, action, message) values ('x', 'x', 'falso')$q$);
select tests.bloqueado('ninguém chama a função interna', $q$select log_event(null, 'x', 'info', 'x', 'falso')$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select tests.ok('plataforma lê tudo', (select count(*) from system_log) > 10);
select tests.bloqueado('nem a plataforma apaga linha do log', $q$delete from system_log$q$);
select tests.ok('filtro por tópico', (select bool_and(topic = 'expediente') and count(*) > 0 from platform_system_log(p_topics => array['expediente'])));
select tests.ok('filtro por nível', (select bool_and(level = 'warning') and count(*) > 0 from platform_system_log(p_levels => array['warning'])));
select tests.ok('busca por cliente', (select count(*) > 0 and bool_and(message like '%Joana%' or details::text like '%Joana%') from platform_system_log(p_search => 'joana')));
select tests.ok('busca por IP', (select count(*) > 0 from platform_system_log(p_search => '200.1.2.3')));
select tests.ok('filtro por empresa', (select count(*) = 0 from platform_system_log(p_company => 'bbbbbbbb-0000-0000-0000-000000000000')));
select max(id) as maxid from system_log \gset
select tests.ok('paginação: antes e depois de um id',
  (select count(*) = 0 from platform_system_log(p_after => :maxid)) and (select bool_and(id < :maxid) from platform_system_log(p_before => :maxid)));
select tests.as_user(null);
select tests.bloqueado('visitante não lê o log', $q$select 1/(select count(*) from system_log)$q$);
select tests.bloqueado('visitante não chama a leitura', $q$select platform_system_log()$q$);
rollback;
