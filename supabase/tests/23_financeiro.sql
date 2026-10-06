-- Testes do financeiro e relatórios (Fases 3 e 4). Tudo desfeito no final.
\set QUIET on
begin;
-- Dados montados direto (sem passar pelo app): 3 entregas de C1 hoje,
-- 1 de C2, 1 cancelado; posições de C1 somando ~2,2 km.
reset role;
-- Âncora de horário: perto da meia-noite os dados cairiam no dia anterior (fuso de São Paulo).
select greatest(now(), ((now() at time zone 'America/Sao_Paulo')::date + time '02:00') at time zone 'America/Sao_Paulo') as t0 \gset
update companies set courier_daily_rate = 50, courier_per_delivery = 4, courier_per_km = 1
  where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into delivery_zones (company_id, name, fee, eta_minutes) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Centro', 5.00, 30) returning id as zona \gset
insert into delivery_orders (company_id, customer_name, address_neighborhood, zone_id, subtotal, delivery_fee, payment_method,
                             status, courier_id, created_at, ready_at, dispatched_at, delivered_at, delivered_by_code) values
 ('aaaaaaaa-0000-0000-0000-000000000000','A','Centro',:'zona',30,5,'dinheiro','delivered','00000000-0000-0000-0000-0000000000c1',
   (:'t0'::timestamptz)-interval '90 min', (:'t0'::timestamptz)-interval '80 min', (:'t0'::timestamptz)-interval '70 min', (:'t0'::timestamptz)-interval '60 min', true),
 ('aaaaaaaa-0000-0000-0000-000000000000','B','Centro',:'zona',20,5,'pix','delivered','00000000-0000-0000-0000-0000000000c1',
   (:'t0'::timestamptz)-interval '40 min', (:'t0'::timestamptz)-interval '35 min', (:'t0'::timestamptz)-interval '30 min', (:'t0'::timestamptz)-interval '20 min', true),
 ('aaaaaaaa-0000-0000-0000-000000000000','C','Vila',null,10,null,'cartao','delivered','00000000-0000-0000-0000-0000000000c1',
   (:'t0'::timestamptz)-interval '30 min', null, (:'t0'::timestamptz)-interval '20 min', (:'t0'::timestamptz)-interval '10 min', false),
 ('aaaaaaaa-0000-0000-0000-000000000000','D','Vila',null,15,3,'dinheiro','delivered','00000000-0000-0000-0000-0000000000c2',
   (:'t0'::timestamptz)-interval '30 min', null, (:'t0'::timestamptz)-interval '20 min', (:'t0'::timestamptz)-interval '10 min', true),
 ('aaaaaaaa-0000-0000-0000-000000000000','E','Vila',null,99,0,'pix','cancelled',null, (:'t0'::timestamptz)-interval '5 min', null, null, null, null);
update delivery_orders set forced_reason = 'cliente sem código' where customer_name = 'C';
select id as pedido_a from delivery_orders where customer_name = 'A' \gset
insert into location_pings (company_id, courier_id, lat, lng, recorded_at) values
 ('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c1', -23.5500, -46.6300, (:'t0'::timestamptz)-interval '50 min'),
 ('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c1', -23.5590, -46.6300, (:'t0'::timestamptz)-interval '45 min'),
 ('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c1', -23.5590, -46.6400, (:'t0'::timestamptz)-interval '40 min'),
 -- salto de GPS (≈ 50 km): ignorado
 ('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c1', -23.1000, -46.6400, (:'t0'::timestamptz)-interval '39 min');

-- ---------- Relatório financeiro ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select report_financial((now() at time zone 'America/Sao_Paulo')::date - 1, (now() at time zone 'America/Sao_Paulo')::date) as fin \gset
select tests.ok('financeiro: entregues e cancelados', (:'fin'::jsonb->'totals'->>'delivered')::int = 4
  and (:'fin'::jsonb->'totals'->>'cancelled')::int = 1);
select tests.ok('financeiro: faturamento só de entregues (35+25+10+18)', (:'fin'::jsonb->'totals'->>'revenue')::numeric = 88);
select tests.ok('financeiro: taxas', (:'fin'::jsonb->'totals'->>'fees')::numeric = 13);
select tests.ok('financeiro: por forma de pagamento', (select (x->>'total')::numeric from jsonb_array_elements(:'fin'::jsonb->'by_payment') x where x->>'key' = 'dinheiro') = 53);
select tests.ok('financeiro: dinheiro ainda não conferido', (:'fin'::jsonb->'totals'->>'unconfirmed_cash')::numeric = 53);
select tests.ok('financeiro: por bairro', jsonb_array_length(:'fin'::jsonb->'by_neighborhood') = 2);

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não vê relatório financeiro', $q$select report_financial((now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000e1');
select tests.bloqueado('supervisor não vê relatório financeiro', $q$select report_financial((now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.ok('outra empresa vê só os próprios números', (report_financial((now() at time zone 'America/Sao_Paulo')::date - 1, (now() at time zone 'America/Sao_Paulo')::date)->'totals'->>'orders')::int = 0);
select tests.ok('admin não escolhe outra empresa no relatório',
  (report_financial((now() at time zone 'America/Sao_Paulo')::date - 1, (now() at time zone 'America/Sao_Paulo')::date, 'aaaaaaaa-0000-0000-0000-000000000000')->'totals'->>'orders')::int = 0);
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select tests.ok('plataforma vê relatório de uma empresa',
  (report_financial((now() at time zone 'America/Sao_Paulo')::date - 1, (now() at time zone 'America/Sao_Paulo')::date, 'aaaaaaaa-0000-0000-0000-000000000000')->'totals'->>'orders')::int = 5);

-- ---------- Produtividade ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select report_productivity((now() at time zone 'America/Sao_Paulo')::date - 1, (now() at time zone 'America/Sao_Paulo')::date) as prod \gset
select (x) as c1 from jsonb_array_elements(:'prod'::jsonb->'couriers') x where x->>'name' = 'C1' \gset
select tests.ok('produtividade: entregas por motoboy', (:'c1'::jsonb->>'deliveries')::int = 3);
select tests.ok('produtividade: entrega forçada contada', (:'c1'::jsonb->>'forced')::int = 1);
select tests.ok('produtividade: km ignora salto de GPS (~2,0 km)', (:'c1'::jsonb->>'km')::numeric between 1.9 and 2.1);
select tests.ok('produtividade: atraso pelo tempo do bairro (A levou 30 min, B 20)', (:'c1'::jsonb->>'late')::int = 0);
select tests.ok('produtividade: tempo médio de preparo', (:'prod'::jsonb->'times'->>'prep_min')::numeric between 7 and 8);

-- ---------- Turno ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select start_shift() as turno \gset
select tests.bloqueado('não abre dois turnos', $q$select start_shift()$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('admin não inicia turno', $q$select start_shift()$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.bloqueado('outro motoboy não encerra turno alheio', format($q$select end_shift(%L)$q$, :'turno'));
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.bloqueado('admin de outra empresa não encerra turno', format($q$select end_shift(%L)$q$, :'turno'));
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select end_shift();
select tests.ok('turno encerrado', (select ended_at is not null from courier_shifts where id = :'turno'));
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.ok('motoboy não vê turno de outro', (select count(*) from courier_shifts) = 0);

-- ---------- Conferência de pagamento ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('recebimento não é marcado direto', format($q$update delivery_orders set payment_received = true where id = %L$q$, :'pedido_a'));
select tests.ok('conferência marca o dinheiro recebido', confirm_payments(array[:'pedido_a']::uuid[]) = 1);
select tests.ok('conferência registra quem recebeu', (select payment_received_by = '00000000-0000-0000-0000-0000000000a1' from delivery_orders where id = :'pedido_a'));
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não confere pagamento', format($q$select confirm_payments(array[%L]::uuid[])$q$, :'pedido_a'));

-- ---------- Caixa do dia ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into cash_movements (company_id, kind, amount, note) values ('aaaaaaaa-0000-0000-0000-000000000000', 'opening', 100, 'troco');
insert into cash_movements (company_id, kind, amount, note) values ('aaaaaaaa-0000-0000-0000-000000000000', 'expense', 20, 'gasolina');
select report_cash_day((now() at time zone 'America/Sao_Paulo')::date) as caixa \gset
select tests.ok('caixa: vendas em dinheiro e recebido', (:'caixa'::jsonb->>'cash_sales')::numeric = 53 and (:'caixa'::jsonb->>'cash_received')::numeric = 35);
select tests.ok('caixa: abertura e despesa', (:'caixa'::jsonb->>'opening')::numeric = 100 and (:'caixa'::jsonb->>'expenses')::numeric = 20);
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não lança no caixa', $q$insert into cash_movements (company_id, kind, amount) values ('aaaaaaaa-0000-0000-0000-000000000000', 'withdrawal', 5)$q$);
select tests.ok('motoboy não vê o caixa', (select count(*) from cash_movements) = 0);
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.bloqueado('outra empresa não lança no caixa alheio', $q$insert into cash_movements (company_id, kind, amount) values ('aaaaaaaa-0000-0000-0000-000000000000', 'withdrawal', 5)$q$);

-- ---------- Acerto do motoboy ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into courier_rates (courier_id, company_id, per_delivery) values ('00000000-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000000', 6);
select tests.bloqueado('valor de motoboy de outra empresa', $q$insert into courier_rates (courier_id, company_id, per_delivery) values ('00000000-0000-0000-0000-0000000000bc', 'aaaaaaaa-0000-0000-0000-000000000000', 1)$q$);
select preview_settlement('00000000-0000-0000-0000-0000000000c1', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date) as prev \gset
select tests.ok('acerto: 1 dia x 50 + 3 entregas x 4 + km x 1',
  (:'prev'::jsonb->>'days_worked')::int = 1 and (:'prev'::jsonb->>'delivery_total')::numeric = 12
  and (:'prev'::jsonb->>'total')::numeric between 63.9 and 64.1);
select tests.ok('acerto: dinheiro em mãos do motoboy', (:'prev'::jsonb->>'cash_collected')::numeric = 30 + 5);
select tests.ok('acerto: valor próprio do motoboy substitui o padrão',
  (preview_settlement('00000000-0000-0000-0000-0000000000c2', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)->>'per_delivery')::numeric = 6);
select create_settlement('00000000-0000-0000-0000-0000000000c1', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date, -4, 'vale') as acerto \gset
select tests.ok('acerto gravado com ajuste', (select total between 59.9 and 60.1 and status = 'open' from settlements where id = :'acerto'));
select tests.bloqueado('não cria acerto sobreposto', $q$select create_settlement('00000000-0000-0000-0000-0000000000c1', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)$q$);
select tests.bloqueado('acerto não é alterado direto', format($q$update settlements set total = 999 where id = %L$q$, :'acerto'));
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy vê o próprio acerto', (select count(*) from settlements) = 1);
select tests.bloqueado('motoboy não dá baixa no acerto', format($q$select pay_settlement(%L)$q$, :'acerto'));
select tests.bloqueado('motoboy não vê prévia de outro', $q$select preview_settlement('00000000-0000-0000-0000-0000000000c2', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.ok('outro motoboy não vê o acerto', (select count(*) from settlements) = 0);
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.bloqueado('admin de outra empresa não paga acerto', format($q$select pay_settlement(%L)$q$, :'acerto'));
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select pay_settlement(:'acerto');
select tests.ok('acerto pago', (select status = 'paid' from settlements where id = :'acerto'));
select tests.bloqueado('acerto pago não é excluído', format($q$select delete_settlement(%L)$q$, :'acerto'));

-- ---------- Licença: faturas e bloqueio ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('empresa não muda a própria mensalidade', $q$update companies set monthly_price = 1 where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$);
select tests.permitido('empresa ajusta valores do motoboy', $q$update companies set courier_per_km = 2 where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$);
select tests.bloqueado('empresa não gera faturas', $q$select generate_license_invoices(current_date)$q$);
select tests.bloqueado('empresa não roda bloqueio', $q$select apply_overdue_suspensions()$q$);
select tests.bloqueado('empresa não vê relatório de licenças', $q$select report_license_usage()$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
update companies set monthly_price = 199, billing_day = 5 where id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000');
select tests.ok('plataforma gera faturas do mês', generate_license_invoices(date '2026-01-15') = 2);
select tests.ok('não duplica faturas', generate_license_invoices(date '2026-01-01') = 0);
update license_invoices set status = 'paid', paid_at = now() where company_id = 'bbbbbbbb-0000-0000-0000-000000000000';
select apply_overdue_suspensions() as suspensas \gset
select tests.ok('bloqueio suspende só quem está vencido', :suspensas = 1
  and (select status from companies where id = 'aaaaaaaa-0000-0000-0000-000000000000') = 'suspended'
  and (select status from companies where id = 'bbbbbbbb-0000-0000-0000-000000000000') = 'active');
select report_license_usage() as uso \gset
select tests.ok('uso de licença: vagas e atraso', (select (x->>'seats_used')::int = 2 and (x->>'overdue_amount')::numeric = 199
  from jsonb_array_elements(:'uso'::jsonb) x where x->>'name' = 'Empresa A'));
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('empresa vê as próprias faturas', (select count(*) from license_invoices) = 1);
select tests.bloqueado('empresa não dá baixa na própria fatura', $q$update license_invoices set status = 'paid'$q$);
rollback;
