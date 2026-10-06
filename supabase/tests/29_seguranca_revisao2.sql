-- Segunda revisão de segurança (06/10/2026): cada teste é uma falha que existia.
\set QUIET on
begin;

-- ---------- Visitante sem login ----------
select tests.as_user(null);
select tests.bloqueado('anônimo não remove colaborador', $q$select remove_collaborator('00000000-0000-0000-0000-0000000000c1')$q$);
select tests.bloqueado('anônimo não muda cargo', $q$select set_collaborator_role('00000000-0000-0000-0000-0000000000c1', 'company_admin')$q$);
select tests.bloqueado('anônimo não vê acerto de motoboy', $q$select preview_settlement('00000000-0000-0000-0000-0000000000c1', current_date - 1, current_date)$q$);
select tests.bloqueado('anônimo não encerra turno', $q$select end_shift()$q$);
select tests.bloqueado('anônimo não pausa motoboy', $q$select set_shift_paused(true, '00000000-0000-0000-0000-0000000000c1')$q$);
select tests.bloqueado('anônimo não grava auditoria', $q$select log_audit('aaaaaaaa-0000-0000-0000-000000000000', 'x')$q$);
select tests.bloqueado('anônimo não chama função interna', $q$select create_delivery_order('{}'::jsonb, '[]'::jsonb)$q$);
select tests.ok('anônimo abre a página de avaliação', has_function_privilege('anon', 'public.get_rating_context(uuid)', 'execute'));

-- ---------- Logado e sem empresa ----------
select tests.as_user('00000000-0000-0000-0000-0000000000ff');
select tests.bloqueado('sem empresa não remove colaborador', $q$select remove_collaborator('00000000-0000-0000-0000-0000000000c1')$q$);
select tests.bloqueado('sem empresa não muda cargo', $q$select set_collaborator_role('00000000-0000-0000-0000-0000000000c1', 'supervisor')$q$);
select tests.bloqueado('chave já ativada não é usada de novo', $q$select redeem_license_key('LIC-A')$q$);
select tests.bloqueado('auditoria não é forjada', $q$select log_audit('aaaaaaaa-0000-0000-0000-000000000000', 'x')$q$);

-- ---------- Quem já tem empresa não troca por convite ----------
select tests.as_user('00000000-0000-0000-0000-0000000000bc');
select tests.bloqueado('motoboy de B não entra em A pelo convite', $q$select redeem_invite_code('INV-A')$q$);
select tests.bloqueado('admin de B não pega licença de outra', $q$select redeem_license_key('LIC-A')$q$);

-- ---------- Admin ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('admin não remove a si mesmo', $q$select remove_collaborator('00000000-0000-0000-0000-0000000000a1')$q$);
select tests.bloqueado('admin não remove gente de outra empresa', $q$select remove_collaborator('00000000-0000-0000-0000-0000000000bc')$q$);
select tests.bloqueado('notificação não é criada direto', $q$insert into notifications (company_id, user_id, type, title) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'x', 'falsa')$q$);
select tests.bloqueado('designação não vai para motoboy de outra empresa',
  $q$insert into assignments (company_id, service_id, collaborator_id, customer_name, scheduled_start) values ('aaaaaaaa-0000-0000-0000-000000000000', '5e000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000bc', 'X', now())$q$);
select tests.bloqueado('designação não usa serviço de outra empresa',
  $q$insert into assignments (company_id, service_id, collaborator_id, customer_name, scheduled_start) values ('aaaaaaaa-0000-0000-0000-000000000000', '5e000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'X', now())$q$);
select tests.bloqueado('admin não se dá nota de avaliação', $q$update assignments set customer_rating = 5 where id = 'a5000000-0000-0000-0000-0000000000c1'$q$);
select tests.ok('link de avaliação não fica na designação', (select rating_token is null from assignments where id = 'a5000000-0000-0000-0000-0000000000c1'));
select tests.ok('gestor lê o link de avaliação na tabela própria', (select count(*) from assignment_rating_tokens where assignment_id = 'a5000000-0000-0000-0000-0000000000c1') = 1);
select tests.bloqueado('campo antigo de saldo não é alterado', $q$update profiles set wallet_balance = 999 where id = '00000000-0000-0000-0000-0000000000c1'$q$);

-- Pedido encerrado não muda valores.
insert into products (company_id, name, price) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Suco', 10) returning id as suco \gset
select create_delivery_order(jsonb_build_object('order_type', 'local', 'customer_name', 'Z'),
  jsonb_build_array(jsonb_build_object('product_id', :'suco', 'quantity', 1))) as oz \gset
select complete_local_order(:'oz');
select tests.bloqueado('pedido entregue não muda o valor', format($q$update delivery_orders set subtotal = 1 where id = %L$q$, :'oz'));

-- ---------- Motoboy ----------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não lê o link de avaliação', $q$select 1/(select count(*) from assignment_rating_tokens)$q$);
select tests.bloqueado('motoboy não se avalia', $q$update assignments set customer_rating = 5 where id = 'a5000000-0000-0000-0000-0000000000c1'$q$);
insert into location_pings (company_id, courier_id, lat, lng, recorded_at)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', -23.55, -46.63, now() - interval '3 hours');
select tests.ok('posição grava a hora do servidor', (select max(recorded_at) from location_pings where courier_id = '00000000-0000-0000-0000-0000000000c1') = now());
insert into chat_messages (company_id, collaborator_id, sender_id, ciphertext, iv)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'abc', 'iv') returning id as msg \gset
select tests.bloqueado('mensagem enviada não é adulterada', format($q$update chat_messages set ciphertext = 'outro' where id = %L$q$, :'msg'));
select tests.permitido('motoboy marca mensagem como lida', format($q$update chat_messages set read_by_collaborator = true where id = %L$q$, :'msg'));
select tests.bloqueado('mensagem não vai para sala de outra empresa',
  $q$insert into chat_messages (company_id, collaborator_id, sender_id, ciphertext, iv) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000bc', '00000000-0000-0000-0000-0000000000c1', 'x', 'y')$q$);
select tests.bloqueado('motoboy não apaga foto', $q$delete from assignment_photos where assignment_id = 'a5000000-0000-0000-0000-0000000000c1'$q$);

-- ---------- Supervisor removido perde a equipe ----------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select set_collaborator_role('00000000-0000-0000-0000-0000000000e1', 'collaborator');
select tests.ok('equipe sai do supervisor rebaixado', (select supervised_by is null from profiles where id = '00000000-0000-0000-0000-0000000000c1'));

-- ---------- Empresa suspensa ----------
reset role;
update companies set status = 'suspended' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('empresa suspensa não vê os pedidos', (select count(*) from delivery_orders) = 0);
select tests.ok('painel sabe que está suspensa', my_company_status() = 'suspended');
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy de empresa suspensa não vê designações', (select count(*) from assignments) = 0);
rollback;
