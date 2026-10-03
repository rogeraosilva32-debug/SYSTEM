-- Testes da marca própria.
\set QUIET on
begin;
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.bloqueado('sem liberação, admin não muda a marca', $q$update companies set brand_color = '#E30613'$q$);
select tests.bloqueado('sem liberação, admin não envia imagem', $q$insert into storage.objects (bucket_id, name) values ('company-branding', 'aaaaaaaa-0000-0000-0000-000000000000/logo.png')$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
update companies set feature_branding = true where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
update companies set brand_color = '#E30613', brand_logo_url = 'https://x/logo.png';
select tests.ok('liberado, admin muda a marca', (select brand_color from my_company_settings()) = '#E30613');
select tests.bloqueado('cor precisa ser hexadecimal', $q$update companies set brand_color = 'vermelho'$q$);
select tests.permitido('liberado, admin envia imagem na pasta da empresa', $q$insert into storage.objects (bucket_id, name) values ('company-branding', 'aaaaaaaa-0000-0000-0000-000000000000/logo.png')$q$);
select tests.bloqueado('admin não envia imagem na pasta de outra empresa', $q$insert into storage.objects (bucket_id, name) values ('company-branding', 'bbbbbbbb-0000-0000-0000-000000000000/logo.png')$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.bloqueado('motoboy não envia imagem de marca', $q$insert into storage.objects (bucket_id, name) values ('company-branding', 'aaaaaaaa-0000-0000-0000-000000000000/x.png')$q$);
select tests.ok('motoboy recebe a marca da empresa', (select brand_logo_url from my_company_settings()) = 'https://x/logo.png');
select tests.as_user('00000000-0000-0000-0000-0000000000a0');
update companies set feature_branding = false where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('plataforma desliga: marca some do app', (select brand_logo_url from my_company_settings()) is null);
select tests.ok('fim da suíte de marca', true);
rollback;
