-- Dados de teste: plataforma P; empresa A (admin A1, motoboys C1 e C2,
-- supervisor S1 que supervisiona C1); empresa B (admin B1, motoboy BC).
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a0','p@t'),
 ('00000000-0000-0000-0000-0000000000a1','a1@t'),
 ('00000000-0000-0000-0000-0000000000c1','c1@t'),
 ('00000000-0000-0000-0000-0000000000c2','c2@t'),
 ('00000000-0000-0000-0000-0000000000e1','s1@t'),
 ('00000000-0000-0000-0000-0000000000b1','b1@t'),
 ('00000000-0000-0000-0000-0000000000bc','bc@t'),
 ('00000000-0000-0000-0000-0000000000ff','novo@t');

insert into public.companies (id, name, license_key, collaborator_invite_code, seats_limit) values
 ('aaaaaaaa-0000-0000-0000-000000000000','Empresa A','LIC-A','INV-A',5),
 ('bbbbbbbb-0000-0000-0000-000000000000','Empresa B','LIC-B','INV-B',5);

insert into public.profiles (id, email, name, company_id, company_role, is_platform_admin) values
 ('00000000-0000-0000-0000-0000000000a0','p@t','P',null,null,true),
 ('00000000-0000-0000-0000-0000000000a1','a1@t','A1','aaaaaaaa-0000-0000-0000-000000000000','company_admin',false),
 ('00000000-0000-0000-0000-0000000000c1','c1@t','C1','aaaaaaaa-0000-0000-0000-000000000000','collaborator',false),
 ('00000000-0000-0000-0000-0000000000c2','c2@t','C2','aaaaaaaa-0000-0000-0000-000000000000','collaborator',false),
 ('00000000-0000-0000-0000-0000000000e1','s1@t','S1','aaaaaaaa-0000-0000-0000-000000000000','supervisor',false),
 ('00000000-0000-0000-0000-0000000000b1','b1@t','B1','bbbbbbbb-0000-0000-0000-000000000000','company_admin',false),
 ('00000000-0000-0000-0000-0000000000bc','bc@t','BC','bbbbbbbb-0000-0000-0000-000000000000','collaborator',false);
update public.profiles set supervised_by = '00000000-0000-0000-0000-0000000000e1' where id = '00000000-0000-0000-0000-0000000000c1';

insert into public.services (id, company_id, name) values
 ('5e000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000000','Entrega A'),
 ('5e000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000000','Entrega B');

insert into public.assignments (id, company_id, service_id, collaborator_id, customer_name, customer_phone, scheduled_start) values
 ('a5000000-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-000000000000','5e000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','Cliente 1','111',now()),
 ('a5000000-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-000000000000','5e000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c2','Cliente 2','222',now()),
 ('a5000000-0000-0000-0000-0000000000bc','bbbbbbbb-0000-0000-0000-000000000000','5e000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000bc','Cliente B','333',now());

insert into public.assignment_photos (assignment_id, company_id, kind, url) values
 ('a5000000-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-000000000000','after','x');
insert into public.api_keys (company_id, key) values ('aaaaaaaa-0000-0000-0000-000000000000','sa_segredo');
insert into public.crm_integrations (company_id, api_key) values ('aaaaaaaa-0000-0000-0000-000000000000','crm_segredo');

-- Os testes antigos montam saídas à mão; o despacho automático (padrão
-- ligado) é testado em 26_despacho_auto.sql.
update public.companies set auto_dispatch = false;
