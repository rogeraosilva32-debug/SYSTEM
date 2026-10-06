-- Recursos da plataforma: modo suporte (ver como empresa), avisos,
-- planos com limite e alertas automáticos.
\set QUIET on
begin;
reset role;
insert into delivery_orders (company_id, customer_name, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Pedido A', 10, 'received'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Pedido B', 10, 'received');

-- ---------- Modo suporte ----------
savepoint suporte;
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select set_config('request.headers', '{"x-suporte-empresa": "aaaaaaaa-0000-0000-0000-000000000000"}', true);
select api_pre_request();
select tests.ok('modo suporte ativo para a plataforma', support_status() = 'aaaaaaaa-0000-0000-0000-000000000000');
select tests.ok('vale como a empresa escolhida', my_company_id() = 'aaaaaaaa-0000-0000-0000-000000000000' and my_company_role() = 'company_admin');
select tests.ok('deixa de ser plataforma enquanto isso', not is_platform_admin());
select tests.ok('vê os pedidos da empresa', (select count(*) from delivery_orders where customer_name = 'Pedido A') = 1);
select tests.ok('não vê pedidos de outra empresa', (select count(*) from delivery_orders where customer_name = 'Pedido B') = 0);
select tests.ok('não vê outras empresas', (select count(*) from companies) = 1);
select tests.bloqueado('só leitura: não altera pedido', $q$update delivery_orders set customer_name = 'X' where customer_name = 'Pedido A'$q$);
select tests.bloqueado('só leitura: não cria pedido', $q$insert into delivery_orders (company_id, customer_name, subtotal) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Novo', 1)$q$);
rollback to savepoint suporte;

savepoint suporte2;
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select set_config('request.headers', '{"x-suporte-empresa": "bbbbbbbb-0000-0000-0000-000000000000"}', true);
select api_pre_request();
select tests.ok('gestor comum não usa o modo suporte', support_status() is null and my_company_id() = 'aaaaaaaa-0000-0000-0000-000000000000');
select tests.ok('gestor comum continua podendo gravar', current_setting('transaction_read_only') = 'off');
rollback to savepoint suporte2;

savepoint suporte3;
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select set_config('request.headers', '{"x-suporte-empresa": "nao-e-uuid"}', true);
select api_pre_request();
select tests.ok('cabeçalho inválido é ignorado', support_status() is null and is_platform_admin());
rollback to savepoint suporte3;

select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select support_view_log('aaaaaaaa-0000-0000-0000-000000000000', 'start');
select tests.ok('entrada no modo suporte vai para o log', exists (select 1 from system_log where action = 'support_start' and company_id = 'aaaaaaaa-0000-0000-0000-000000000000'));
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('gestor não grava log de suporte', $q$select support_view_log('aaaaaaaa-0000-0000-0000-000000000000', 'start')$q$);

-- ---------- Avisos ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select save_platform_notice(null, 'Manutenção hoje', 'Às 23h o sistema fica fora 10 min.', 'warning', 'admins', null, null, null) as n1 \gset
select save_platform_notice(null, 'Só para a B', '', 'info', 'all', array['bbbbbbbb-0000-0000-0000-000000000000']::uuid[], null, null) as n2 \gset
select save_platform_notice(null, 'Futuro', '', 'info', 'all', null, now() + interval '1 day', null) as n3 \gset
select tests.ok('aviso publicado vai para o log', exists (select 1 from system_log where action = 'notice_created'));
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('gestor vê o aviso para todas', (select count(*) from my_platform_notices() where id = :'n1') = 1);
select tests.ok('gestor não vê aviso de outra empresa', (select count(*) from my_platform_notices() where id = :'n2') = 0);
select tests.ok('aviso agendado ainda não aparece', (select count(*) from my_platform_notices() where id = :'n3') = 0);
select tests.bloqueado('gestor não cria aviso', $q$select save_platform_notice(null, 'x', '', 'info', 'all', null, null, null)$q$);
select tests.bloqueado('gestor não lê a tabela de avisos', $q$select 1 from platform_notices$q$);
select dismiss_platform_notice(:'n1');
select tests.ok('fechou, não aparece mais', (select count(*) from my_platform_notices() where id = :'n1') = 0);
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy não vê aviso só para gestores', (select count(*) from my_platform_notices() where id = :'n1') = 0);
select tests.as_user('00000000-0000-0000-0000-0000000000bc');
select tests.ok('motoboy da B vê aviso para todos da B', (select count(*) from my_platform_notices() where id = :'n2') = 1);
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select delete_platform_notice(:'n2');
select tests.ok('plataforma apaga aviso', not exists (select 1 from platform_notices where id = :'n2'));

-- ---------- Planos ----------
insert into plans (name, monthly_price, seats_limit, max_orders_month, feature_branding) values ('Básico', 99, 3, 2, true) returning id as plano \gset
select apply_plan('aaaaaaaa-0000-0000-0000-000000000000', :'plano');
select tests.ok('plano aplica vagas, mensalidade e recursos',
  (select seats_limit = 3 and monthly_price = 99 and feature_branding and plan_id = :'plano' from companies where id = 'aaaaaaaa-0000-0000-0000-000000000000'));
update plans set seats_limit = 4, monthly_price = 120 where id = :'plano';
select tests.ok('mudar o plano atualiza as empresas nele',
  (select seats_limit = 4 and monthly_price = 120 from companies where id = 'aaaaaaaa-0000-0000-0000-000000000000'));
select tests.ok('plano criado e alterado vão para o log', (select count(*) from system_log where action in ('plan_created', 'plan_updated')) >= 2);
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('gestor vê o uso do plano', (my_plan_usage() ->> 'orders_month')::int = 1 and my_plan_usage() ->> 'plan' = 'Básico');
select tests.bloqueado('gestor não aplica plano', format($q$select apply_plan('aaaaaaaa-0000-0000-0000-000000000000', %L)$q$, :'plano'));
select tests.bloqueado('gestor não muda plano', $q$update plans set max_orders_month = 999$q$);
select tests.permitido('pedido dentro do limite entra', $q$insert into delivery_orders (company_id, customer_name, subtotal) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Dentro', 1)$q$);
reset role;
insert into delivery_orders (company_id, customer_name, subtotal) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Segundo', 1);
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('passou do limite do plano, não entra', $q$insert into delivery_orders (company_id, customer_name, subtotal) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Fora', 1)$q$);
select tests.permitido('outra empresa sem plano continua livre', $q$select 1 from companies$q$);

-- ---------- Alertas ----------
reset role;
insert into delivery_orders (company_id, customer_name, subtotal, status, created_at) values
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Parado', 10, 'preparing', now() - interval '5 hours');
insert into license_invoices (company_id, reference_month, amount, due_date) values
  ('bbbbbbbb-0000-0000-0000-000000000000', date_trunc('month', current_date - 60)::date, 50, current_date - 3);
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select platform_check_alerts() as abertos \gset
select tests.ok('abre alerta de pedido parado', exists (select 1 from platform_alerts_list() where kind = 'stuck_orders' and company_name = 'Empresa B'));
select tests.ok('abre alerta de fatura vencida', exists (select 1 from platform_alerts_list() where kind = 'invoice_overdue' and company_name = 'Empresa B'));
select tests.ok('abre alerta de limite do plano', exists (select 1 from platform_alerts_list() where kind = 'plan_orders' and company_name = 'Empresa A'));
select tests.ok('alerta vai para o log', exists (select 1 from system_log where action = 'alert_stuck_orders'));
select platform_check_alerts() as de_novo \gset
select tests.ok('rodar de novo não duplica', :de_novo = 0);
reset role;
update delivery_orders set status = 'delivered' where customer_name = 'Parado';
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select platform_check_alerts();
select tests.ok('situação resolvida fecha o alerta sozinho', not exists (select 1 from platform_alerts_list() where kind = 'stuck_orders'));
select tests.ok('fechado aparece no histórico', exists (select 1 from platform_alerts_list(true) where kind = 'stuck_orders' and resolved_at is not null));
select id as alerta from platform_alerts_list() where kind = 'invoice_overdue' \gset
select platform_alert_seen(:'alerta');
select tests.ok('marcar como visto', (select seen_at is not null from platform_alerts_list() where id = :'alerta'));
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('gestor não vê alertas da plataforma', (select count(*) from platform_alerts_list()) = 0);
select tests.bloqueado('gestor não roda a conferência', $q$select platform_check_alerts()$q$);
select tests.as_user(null);
select tests.bloqueado('visitante não lê alertas', $q$select 1 from platform_alerts$q$);
rollback;
