-- Cardápio da Pantera Lanches (fotos enviadas em 05/10/2026).
-- Como usar: rode DEPOIS do supabase-b2b-schema.sql, no SQL Editor do
-- Supabase. Se só existe uma empresa cadastrada, o cardápio vai para ela.
-- Se houver mais de uma, escreva em v_company_name um pedaço do nome
-- dela (o erro lista as empresas cadastradas). Pode rodar de novo:
-- produto que já existe (mesmo nome) é pulado, então preços alterados
-- pela empresa não são sobrescritos.
do $$
declare
  v_company_name text := '';   -- << pedaço do nome da empresa (vazio = a única empresa cadastrada)
  v_company uuid;
  v_n int;
  v_cat uuid;
  r record;
begin
  select count(*), min(id::text)::uuid into v_n, v_company
    from public.companies where lower(name) like '%' || lower(btrim(v_company_name)) || '%';
  if v_n <> 1 then
    raise exception '% Empresas cadastradas: %',
      case when v_n = 0 then format('Nenhuma empresa com "%s" no nome.', v_company_name)
           when btrim(v_company_name) = '' then 'Há mais de uma empresa: escreva um pedaço do nome em v_company_name.'
           else format('Mais de uma empresa com "%s" no nome: use um pedaço mais específico.', v_company_name) end,
      coalesce((select string_agg(name, ', ' order by name) from public.companies), 'nenhuma');
  end if;

  for r in
    select * from (values
      -- categoria, ordem, produto, descrição, preço (sem opções), opções [nome, preço]
      ('Sanduíches tradicionais', 1, 'X-Maionese', 'carne, queijo, maionese', null::numeric,
        '[{"name":"Hambúrguer","price":14.00},{"name":"Frango ou lombo","price":17.50}]'),
      ('Sanduíches tradicionais', 1, 'X-Burguer', 'carne, queijo, presunto e maionese', null,
        '[{"name":"Hambúrguer","price":17.00},{"name":"Frango ou lombo","price":19.50}]'),
      ('Sanduíches tradicionais', 1, 'X-Egg', 'carne, queijo, ovo e maionese', null,
        '[{"name":"Hambúrguer","price":19.00},{"name":"Frango ou lombo","price":21.50}]'),
      ('Sanduíches tradicionais', 1, 'X-Salada', 'carne, queijo, alface, tomate, milho e maionese', null,
        '[{"name":"Hambúrguer","price":21.50},{"name":"Frango ou lombo","price":23.50}]'),
      ('Sanduíches tradicionais', 1, 'X-Salada Egg', 'carne, queijo, alface, tomate, ovo, milho e maionese', null,
        '[{"name":"Hambúrguer","price":22.50},{"name":"Frango ou lombo","price":25.00}]'),
      ('Sanduíches tradicionais', 1, 'X-Bacon', 'carne, queijo, alface, tomate, bacon, milho e maionese', null,
        '[{"name":"Hambúrguer","price":24.00},{"name":"Frango ou lombo","price":27.00}]'),
      ('Sanduíches tradicionais', 1, 'X-Bacon Egg', 'carne, queijo, alface, tomate, bacon, ovo, milho e maionese', null,
        '[{"name":"Hambúrguer","price":25.00},{"name":"Frango ou lombo","price":28.00}]'),
      ('Sanduíches tradicionais', 1, 'X-Laçador', 'carne, queijo, alface, tomate, bacon, presunto, milho e maionese', null,
        '[{"name":"Hambúrguer","price":25.00},{"name":"Frango ou lombo","price":28.00}]'),
      ('Sanduíches tradicionais', 1, 'X-Tudo', 'carne, queijo, alface, tomate, bacon, ovo, presunto, milho, batata e maionese', null,
        '[{"name":"Hambúrguer","price":26.00},{"name":"Frango ou lombo","price":29.50},{"name":"Hambúrguer 120g","price":31.00},{"name":"Aberto · Hambúrguer","price":34.00},{"name":"Aberto · Frango ou lombo","price":37.50}]'),
      ('Sanduíches tradicionais', 1, 'X-Lanchão', '2 carnes de hambúrguer, queijo, alface, tomate, presunto, bacon, ovo, milho, batata, catupiry e maionese', null,
        '[{"name":"Hambúrguer","price":28.50},{"name":"Frango ou lombo","price":30.50},{"name":"Hambúrguer 120g","price":33.50},{"name":"Aberto · Hambúrguer","price":36.50},{"name":"Aberto · Frango ou lombo","price":39.50}]'),

      ('Sanduíches especiais', 2, 'X-Sem Nome', '2 carnes de hambúrguer, queijo, alface, tomate, presunto, ovo, bacon, catupiry, milho, batata, frango ou lombo e maionese', null,
        '[{"name":"Normal","price":32.00},{"name":"Aberto","price":40.00}]'),
      ('Sanduíches especiais', 2, 'X-Pantera', 'carne, frango, lombo, queijo, presunto, alface, tomate, ovo, bacon, catupiry, milho, batata, maionese', null,
        '[{"name":"Normal","price":34.00},{"name":"Aberto","price":42.00}]'),
      ('Sanduíches especiais', 2, 'X-Mata Fome', 'carne, frango, lombo, calabresa, queijo, presunto, alface, tomate, 2 ovos, bacon, catupiry, milho, batata e maionese', null,
        '[{"name":"Normal","price":37.00},{"name":"Aberto","price":45.00}]'),
      ('Sanduíches especiais', 2, 'X-Calabresa', 'calabresa, queijo, catupiry, alface, tomate, cebola e maionese', null,
        '[{"name":"Normal","price":27.00},{"name":"Aberto","price":35.00}]'),
      ('Sanduíches especiais', 2, 'X-Beirute', 'pão, 3 carnes, alface, tomate, bacon, ovo, queijo, presunto, milho, batata, maionese, catupiry', null,
        '[{"name":"Normal","price":33.00},{"name":"Aberto","price":41.00}]'),
      ('Sanduíches especiais', 2, 'X-Quaresma', 'queijo, alface, tomate, ovo, milho, batata, maionese, cheddar ou catupiry', 22.00, '[]'),
      ('Sanduíches especiais', 2, 'X-Brabo', 'pão, 3 hambúrguer 120g, presunto, queijo, alface, tomate, bacon, ovo, milho, batata, catupiry, cheddar, maionese', null,
        '[{"name":"Normal","price":39.00},{"name":"Aberto","price":47.00}]'),
      ('Sanduíches especiais', 2, 'X-Turbinado', 'pão, 2 hambúrguer 120g, 1 frango, lombo, presunto, queijo, alface, tomate, bacon, ovo, milho, batata, catupiry, cheddar, maionese', null,
        '[{"name":"Normal","price":44.00},{"name":"Aberto","price":52.00}]'),

      ('Sanduíches com pão de forma', 3, 'X-Saúde', 'pão integral, frango, presunto, alface, tomate e milho', 20.00, '[]'),
      ('Sanduíches com pão de forma', 3, 'Misto quente', 'presunto e queijo', 19.00, '[]'),
      ('Sanduíches com pão de forma', 3, 'Bauru', 'presunto, queijo, alface, tomate e maionese', 20.00, '[]'),
      ('Sanduíches com pão de forma', 3, 'Americano', 'presunto, queijo, ovo, alface, tomate e maionese', 21.00, '[]'),

      ('Hot dog', 4, 'Doguinho', 'pão, 1 salsicha, molho, batata, maionese, ketchup, milho', 13.00, '[]'),
      ('Hot dog', 4, 'Super Dog', 'pão, 1 salsicha, molho, purê, batata, catupiry, maionese, ketchup, milho', 14.50, '[]'),
      ('Hot dog', 4, 'Dog Duplo', 'pão, 2 salsichas, molho, batata, catupiry ou cheddar, maionese, ketchup, milho', 15.50, '[]'),
      ('Hot dog', 4, 'Dog Especial', 'pão, 2 salsichas, molho, purê, bacon, batata, catupiry ou cheddar, maionese, ketchup, milho', 17.50, '[]'),
      ('Hot dog', 4, 'Big Dog', 'pão, 3 salsichas, molho, bacon, batata, catupiry e cheddar, maionese, ketchup, milho', null,
        '[{"name":"Normal","price":19.00},{"name":"Aberto","price":27.00}]'),
      ('Hot dog', 4, 'Monster Dog', 'pão, 4 salsichas, molho, purê, bacon, batata, catupiry e cheddar, maionese, ketchup, milho', null,
        '[{"name":"Normal","price":22.00},{"name":"Aberto","price":30.00}]')
    ) as t(category, cat_order, name, description, price, variants)
  loop
    insert into public.product_categories (company_id, name, sort_order)
      values (v_company, r.category, r.cat_order)
      on conflict (company_id, name) do nothing;
    select id into v_cat from public.product_categories where company_id = v_company and name = r.category;
    if not exists (select 1 from public.products where company_id = v_company and kind = 'item' and lower(name) = lower(r.name)) then
      insert into public.products (company_id, category_id, kind, name, description, price, variants, sort_order)
        values (v_company, v_cat, 'item', r.name, r.description, coalesce(r.price, 0), r.variants::jsonb,
                (select count(*) from public.products where company_id = v_company and category_id = v_cat));
    end if;
  end loop;

  -- Opcionais (adicionais), valem para qualquer lanche.
  for r in
    select * from (values
      ('Hambúrguer', 4.00, 1), ('Bacon', 5.00, 2), ('Frango ou lombo', 7.00, 3),
      ('Calabresa', 5.00, 4), ('Catupiry ou cheddar', 4.00, 5), ('Milho ou batata', 3.00, 6)
    ) as t(name, price, ord)
  loop
    if not exists (select 1 from public.products where company_id = v_company and kind = 'addon' and lower(name) = lower(r.name)) then
      insert into public.products (company_id, kind, name, price, sort_order)
        values (v_company, 'addon', r.name, r.price, r.ord);
    end if;
  end loop;

  raise notice 'Cardápio cadastrado: % produtos e % adicionais na empresa.',
    (select count(*) from public.products where company_id = v_company and kind = 'item'),
    (select count(*) from public.products where company_id = v_company and kind = 'addon');
end $$;
