-- Testes de permissão. Cada bloco imprime PASSOU ou FALHOU.
-- Rodar com: supabase/tests/run.sh
\set QUIET on
\set ON_ERROR_STOP off
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
create or replace function tests.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  perform set_config('role', case when p is null then 'anon' else 'authenticated' end, true);
end $$;
grant execute on function tests.as_user(uuid) to authenticated, anon;

-- ok(nome, condição)
create or replace function tests.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin raise notice '% %', case when p_cond then 'PASSOU' else 'FALHOU' end, p_name; end $$;
grant execute on function tests.ok(text, boolean) to authenticated, anon;

-- bloqueado(nome, comando): passa se o comando dá erro OU não afeta nenhuma linha
create or replace function tests.bloqueado(p_name text, p_sql text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute p_sql; get diagnostics n = row_count;
    if n = 0 then raise notice 'PASSOU %', p_name; else raise notice 'FALHOU % (afetou % linha(s))', p_name, n; end if;
    raise exception 'desfaz';
  exception when others then
    if sqlerrm = 'desfaz' then null; else raise notice 'PASSOU % (%)', p_name, sqlerrm; end if;
  end;
end $$;
grant execute on function tests.bloqueado(text, text) to authenticated, anon;

-- permitido(nome, comando): passa se o comando funciona e afeta >= 1 linha
create or replace function tests.permitido(p_name text, p_sql text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute p_sql; get diagnostics n = row_count;
    if n > 0 then raise notice 'PASSOU %', p_name; else raise notice 'FALHOU % (nenhuma linha)', p_name; end if;
    raise exception 'desfaz';
  exception when others then
    if sqlerrm = 'desfaz' then null; else raise notice 'FALHOU % (%)', p_name, sqlerrm; end if;
  end;
end $$;
grant execute on function tests.permitido(text, text) to authenticated, anon;

-- ---------------- Licença (companies) ----------------
begin; select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não altera limite de vagas', $q$update companies set seats_limit = 999$q$);
rollback;
begin; select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('admin da empresa não altera limite de vagas', $q$update companies set seats_limit = 999$q$);
select tests.bloqueado('admin da empresa não reativa/suspende a própria empresa', $q$update companies set status = 'suspended'$q$);
select tests.bloqueado('admin da empresa não troca chave de licença', $q$update companies set license_key = 'X'$q$);
select tests.permitido('admin da empresa pode renomear a empresa', $q$update companies set name = 'Novo nome'$q$);
select tests.bloqueado('admin da empresa não altera outra empresa', $q$update companies set name = 'x' where id = 'bbbbbbbb-0000-0000-0000-000000000000'$q$);
rollback;
begin; select tests.as_user('00000000-0000-0000-0000-0000000000e1');
select tests.bloqueado('supervisor não renomeia a empresa', $q$update companies set name = 'x'$q$);
rollback;
begin; select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select tests.permitido('plataforma altera limite de vagas', $q$update companies set seats_limit = 20 where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$);
select tests.permitido('plataforma suspende empresa', $q$update companies set status = 'suspended' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$);
rollback;

begin; select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy não lê a chave de licença da empresa', (select count(*) from companies) = 0);
select tests.ok('motoboy lê os ajustes da empresa pela função', (select name from my_company_settings()) = 'Empresa A');
rollback;
begin; select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('admin lê a própria empresa', (select count(*) from companies) = 1);
rollback;

-- ---------------- Pedidos/designações ----------------
begin; select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy só vê as próprias designações', (select count(*) from assignments) = 1);
select tests.bloqueado('motoboy não altera designação de outro', $q$update assignments set status = 'cancelled' where id = 'a5000000-0000-0000-0000-0000000000c2'$q$);
select tests.permitido('motoboy inicia a própria designação', $q$update assignments set status = 'in_progress', started_at = now() where id = 'a5000000-0000-0000-0000-0000000000c1'$q$);
select tests.bloqueado('motoboy não troca o responsável', $q$update assignments set collaborator_id = '00000000-0000-0000-0000-0000000000c2' where id = 'a5000000-0000-0000-0000-0000000000c1'$q$);
select tests.bloqueado('motoboy não altera dados do cliente', $q$update assignments set customer_phone = '999' where id = 'a5000000-0000-0000-0000-0000000000c1'$q$);
select tests.bloqueado('motoboy não apaga designação', $q$delete from assignments where id = 'a5000000-0000-0000-0000-0000000000c1'$q$);
select tests.bloqueado('motoboy não cria designação', $q$insert into assignments (company_id, service_id, collaborator_id, scheduled_start) values ('aaaaaaaa-0000-0000-0000-000000000000','5e000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1', now())$q$);
select tests.ok('motoboy não vê fotos de pedido de outro', (select count(*) from assignment_photos) = 0);
select tests.ok('motoboy ainda vê o catálogo de serviços', (select count(*) from services) = 1);
select tests.bloqueado('motoboy não altera serviços', $q$update services set name = 'x'$q$);
rollback;

begin; select tests.as_user('00000000-0000-0000-0000-0000000000e1');
select tests.ok('supervisor só vê designações da equipe dele', (select count(*) from assignments) = 1);
select tests.bloqueado('supervisor não cria designação em outra empresa', $q$insert into assignments (company_id, service_id, collaborator_id, scheduled_start) values ('bbbbbbbb-0000-0000-0000-000000000000','5e000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000c1', now())$q$);
select tests.permitido('supervisor cria designação para a equipe', $q$insert into assignments (company_id, service_id, collaborator_id, scheduled_start) values ('aaaaaaaa-0000-0000-0000-000000000000','5e000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1', now())$q$);
select tests.ok('supervisor não vê chaves de API', (select count(*) from api_keys) = 0);
rollback;

begin; select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok('admin vê todas as designações da empresa', (select count(*) from assignments) = 2);
select tests.permitido('admin reatribui designação', $q$update assignments set collaborator_id = '00000000-0000-0000-0000-0000000000c2' where id = 'a5000000-0000-0000-0000-0000000000c1'$q$);
select tests.ok('admin vê chaves de API da empresa', (select count(*) from api_keys) = 1);
select tests.ok('admin não vê dados da outra empresa', (select count(*) from assignments where company_id = 'bbbbbbbb-0000-0000-0000-000000000000') = 0);
rollback;

-- ---------------- Chaves e CRM ----------------
begin; select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy não lê chaves de API', (select count(*) from api_keys) = 0);
select tests.ok('motoboy não lê chave do CRM', (select count(*) from crm_integrations) = 0);
rollback;

-- ---------------- Perfis (auto-promoção) ----------------
begin; select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não apaga o próprio perfil', $q$delete from profiles where id = auth.uid()$q$);
select tests.bloqueado('motoboy não vira admin da plataforma', $q$update profiles set is_platform_admin = true where id = auth.uid()$q$);
select tests.bloqueado('motoboy não escolhe o próprio supervisor', $q$update profiles set supervised_by = '00000000-0000-0000-0000-0000000000b1' where id = auth.uid()$q$);
select tests.permitido('motoboy atualiza a própria localização', $q$update profiles set last_lat = 1, last_lng = 2, last_location_at = now() where id = auth.uid()$q$);
rollback;
begin; select tests.as_user('00000000-0000-0000-0000-0000000000ff');
select tests.bloqueado('usuário novo não se cria como admin da plataforma', $q$insert into profiles (id, email, name, is_platform_admin) values (auth.uid(), 'novo@t', 'N', true)$q$);
select tests.bloqueado('usuário novo não se cria dentro de uma empresa', $q$insert into profiles (id, email, name, company_id, company_role) values (auth.uid(), 'novo@t', 'N', 'aaaaaaaa-0000-0000-0000-000000000000', 'company_admin')$q$);
select tests.permitido('usuário novo cria o próprio perfil básico', $q$insert into profiles (id, email, name) values (auth.uid(), 'novo@t', 'N')$q$);
rollback;

-- ---------------- Sem login ----------------
begin; select tests.as_user(null);
select tests.ok('visitante sem login não vê empresas', (select count(*) from companies) = 0);
select tests.ok('visitante sem login não vê designações', (select count(*) from assignments) = 0);
rollback;

-- ---------------- Funções do sistema continuam funcionando ----------------
begin; select tests.as_user('00000000-0000-0000-0000-0000000000ff');
insert into profiles (id, email, name) values (auth.uid(), 'novo@t', 'N');
select * from redeem_invite_code('INV-A');
select tests.ok('convite: usuário novo entra como colaborador', (select company_role from profiles where id = auth.uid()) = 'collaborator');
rollback;
begin; select tests.as_user('00000000-0000-0000-0000-0000000000ff');
insert into profiles (id, email, name) values (auth.uid(), 'novo@t', 'N');
select * from redeem_invite_code('  inv-a ');
select tests.ok('convite aceita minúsculas e espaços', (select company_role from profiles where id = auth.uid()) = 'collaborator');
rollback;
begin; select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.permitido('admin promove supervisor', $q$select set_collaborator_role('00000000-0000-0000-0000-0000000000c2', 'supervisor')$q$);
select tests.permitido('admin remove colaborador', $q$select remove_collaborator('00000000-0000-0000-0000-0000000000c2')$q$);
select tests.permitido('admin edita nome do colaborador', $q$update profiles set name = 'Novo' where id = '00000000-0000-0000-0000-0000000000c1'$q$);
rollback;
begin; select tests.as_user('00000000-0000-0000-0000-0000000000a0');
select tests.permitido('plataforma cria empresa', $q$insert into companies (name, license_key, collaborator_invite_code) values ('C', 'LIC-C', 'INV-C')$q$);
rollback;
begin; select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.permitido('motoboy conclui atendimento em andamento', $q$update assignments set status = 'in_progress' where id = 'a5000000-0000-0000-0000-0000000000c1'; update assignments set status = 'completed', completed_at = now() where id = 'a5000000-0000-0000-0000-0000000000c1'$q$);
select tests.bloqueado('motoboy não cancela designação', $q$update assignments set status = 'cancelled' where id = 'a5000000-0000-0000-0000-0000000000c1'$q$);
select tests.permitido('motoboy anexa foto na própria designação', $q$insert into assignment_photos (assignment_id, company_id, kind, url) values ('a5000000-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-000000000000','after','y')$q$);
select tests.bloqueado('motoboy não anexa foto em designação de outro', $q$insert into assignment_photos (assignment_id, company_id, kind, url) values ('a5000000-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-000000000000','after','y')$q$);
rollback;
