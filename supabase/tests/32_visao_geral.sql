-- Visão geral da plataforma: só a plataforma chama; números do dia batem.
\set QUIET on
begin;
reset role;
insert into delivery_orders (company_id, customer_name, subtotal, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'V1', 10, 'delivered'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'V2', 20, 'received'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'V3', 30, 'cancelled');
insert into license_invoices (company_id, reference_month, amount, due_date) values
  ('bbbbbbbb-0000-0000-0000-000000000000', date_trunc('month', current_date - 60)::date, 99, current_date - 10);

select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('gestor não vê a visão geral da plataforma', $q$select platform_overview()$q$);
select tests.as_user(null);
select tests.bloqueado('visitante não vê a visão geral', $q$select platform_overview()$q$);

select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select platform_overview() as v \gset
select tests.ok('conta as empresas', (:'v'::jsonb -> 'companies' ->> 'total')::int = 2);
select tests.ok('pedidos de hoje de todas as empresas', (:'v'::jsonb -> 'today' ->> 'orders')::int >= 3);
select tests.ok('faturamento do dia só com entregues',
  (select coalesce(sum(total), 0) from delivery_orders where status = 'delivered' and created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
  = (:'v'::jsonb -> 'today' ->> 'revenue')::numeric);
select tests.ok('fatura vencida aparece', (:'v'::jsonb -> 'billing' ->> 'overdue_companies')::int = 1 and (:'v'::jsonb -> 'billing' ->> 'overdue_amount')::numeric = 99);
select tests.ok('linha por empresa com nome', (select count(*) = 2 and bool_and(e ? 'name' and e ? 'couriers_on_shift') from jsonb_array_elements(:'v'::jsonb -> 'per_company') e));
rollback;
