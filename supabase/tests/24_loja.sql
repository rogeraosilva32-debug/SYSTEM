-- Endereço da loja (origem das rotas).
\set QUIET on
begin;
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.permitido('admin cadastra o endereço da loja', $q$update companies set store_street = 'Rua Direita', store_city = 'São Paulo', store_lat = -23.55, store_lng = -46.63 where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$);
update companies set store_street = 'Rua Direita', store_city = 'São Paulo', store_lat = -23.55, store_lng = -46.63 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok('motoboy recebe a origem da loja', (select store_lat = -23.55 and store_street = 'Rua Direita' from my_company_settings()));
select tests.bloqueado('motoboy não altera o endereço da loja', $q$update companies set store_lat = 0 where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$);
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.bloqueado('outra empresa não altera o endereço da loja', $q$update companies set store_lat = 0 where id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$);
select tests.ok('outra empresa não recebe a origem da loja', (select store_lat is null from my_company_settings()));
rollback;
