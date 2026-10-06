-- =====================================================================
-- ServiçoApp B2B — schema do novo modelo de licenciamento
-- Rode isto inteiro no SQL Editor do Supabase, de cima pra baixo.
-- Seguro rodar mais de uma vez (usa "if not exists" / "on conflict").
-- =====================================================================

-- Extensão necessária pra gen_random_uuid()
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. EMPRESAS (licenças)
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  license_key text not null unique,              -- usada UMA vez pra ativar a empresa (vira company_admin)
  collaborator_invite_code text not null unique, -- usada por colaboradores pra entrar (pode ser regerada)
  seats_limit integer not null default 5,        -- limite de colaboradores (definido por quem vende a licença)
  status text not null default 'active' check (status in ('active', 'suspended')),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. PROFILES ganha vínculo com empresa e papéis
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists company_id uuid references public.companies(id);
alter table public.profiles add column if not exists company_role text check (company_role in ('company_admin', 'collaborator'));
alter table public.profiles add column if not exists is_platform_admin boolean not null default false;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists avatar_url text;

-- Última posição conhecida do colaborador (enviada pelo próprio navegador
-- dele enquanto está com um atendimento em andamento) — é o que permite ao
-- admin da empresa ver "onde ele está agora" no mapa de uma designação.
alter table public.profiles add column if not exists last_lat double precision;
alter table public.profiles add column if not exists last_lng double precision;
alter table public.profiles add column if not exists last_location_at timestamptz;

-- Habilita atualização em tempo real na tabela profiles (necessário pro
-- mapa do admin atualizar sozinho assim que o colaborador manda uma posição
-- nova, em vez de depender só do polling de reforço). Bloco seguro pra rodar
-- de novo — "alter publication ... add table" dá erro se já foi adicionada.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. SERVIÇOS (catálogo de cada empresa)
-- ---------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  default_duration_minutes integer not null default 60,
  price numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. DESIGNAÇÕES (atribuição de um serviço a um colaborador)
-- ---------------------------------------------------------------------
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  service_id uuid not null references public.services(id),
  collaborator_id uuid not null references public.profiles(id),
  created_by uuid references public.profiles(id),
  customer_name text,
  customer_phone text,
  address_street text,
  address_neighborhood text,
  address_city text,
  lat double precision,
  lng double precision,
  scheduled_start timestamptz not null,
  duration_minutes integer not null default 60,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'en_route', 'in_progress', 'completed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists assignments_company_idx on public.assignments(company_id);
create index if not exists assignments_collaborator_idx on public.assignments(collaborator_id);

-- ---------------------------------------------------------------------
-- 5. CHAVES DE API (saída — pra sistemas externos lerem os dados da empresa)
-- ---------------------------------------------------------------------
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null unique,
  label text,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. INTEGRAÇÃO DE CRM (entrada — de onde importar colaboradores/serviços)
-- ---------------------------------------------------------------------
create table if not exists public.crm_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade unique,
  base_url text,
  api_key text,
  field_mapping jsonb default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- RLS — cada empresa só vê os próprios dados; platform_admin vê tudo
-- =====================================================================

alter table public.companies enable row level security;
alter table public.services enable row level security;
alter table public.assignments enable row level security;
alter table public.api_keys enable row level security;
alter table public.crm_integrations enable row level security;

-- Função auxiliar: é platform admin?
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

-- Função auxiliar: company_id do usuário logado
create or replace function public.my_company_id()
returns uuid language sql stable security definer as $$
  select company_id from public.profiles where id = auth.uid();
$$;

-- Função auxiliar: company_role do usuário logado (precisa ser uma função
-- security definer como esta — e não uma subconsulta direto na policy —
-- porque uma subconsulta em "profiles" dentro de uma policy de "profiles"
-- reaciona a própria policy e causa "infinite recursion detected in policy
-- for relation profiles". security definer roda a consulta interna sem
-- reaplicar RLS, quebrando o ciclo.
create or replace function public.my_company_role()
returns text language sql stable security definer as $$
  select company_role from public.profiles where id = auth.uid();
$$;

-- companies: platform_admin gerencia tudo; company_admin só vê/edita a própria
-- (mas não pode alterar seats_limit/license_key — isso é controle de quem vende a licença)
drop policy if exists companies_platform_all on public.companies;
create policy companies_platform_all on public.companies
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists companies_self_read on public.companies;
create policy companies_self_read on public.companies
  for select using (id = public.my_company_id());

drop policy if exists companies_self_update_name on public.companies;
create policy companies_self_update_name on public.companies
  for update using (id = public.my_company_id())
  with check (id = public.my_company_id());

-- Permite ler uma empresa pela license_key/invite_code ainda sem estar vinculado
-- (necessário pra tela de ativação conseguir validar a chave antes do vínculo existir)
drop policy if exists companies_lookup_for_activation on public.companies;

-- =====================================================================
-- SEGURANÇA — leitura/escrita controlada por função, não por policy aberta
-- =====================================================================
--
-- A versão anterior deste arquivo tinha uma policy "for select using (true)"
-- em companies, pra permitir consultar license_key/collaborator_invite_code
-- antes de existir vínculo. Isso deixava a tabela INTEIRA de empresas
-- legível por qualquer requisição com a chave anônima (que é pública, vem
-- embutida no próprio app) — nem precisava estar logado. Substituído pelas
-- duas funções abaixo: elas fazem a checagem da chave "por dentro"
-- (security definer, ignora RLS internamente) e nunca devolvem license_key
-- nem collaborator_invite_code pro cliente.
create or replace function public.redeem_license_key(p_key text)
returns table(company_id uuid, company_name text)
language plpgsql security definer as $$
declare
  v_company record;
begin
  select id, name into v_company from public.companies
    where upper(btrim(license_key)) = upper(btrim(p_key)) and status = 'active';
  if v_company.id is null then
    raise exception 'Chave de licença não encontrada ou inativa.';
  end if;
  update public.profiles set company_id = v_company.id, company_role = 'company_admin' where id = auth.uid();
  perform public.log_audit(v_company.id, 'company_admin_joined', jsonb_build_object('user_id', auth.uid()));
  return query select v_company.id, v_company.name;
end;
$$;

create or replace function public.redeem_invite_code(p_code text)
returns table(company_id uuid, company_name text)
language plpgsql security definer as $$
declare
  v_company record;
  v_seats_used int;
begin
  select id, name, seats_limit into v_company from public.companies
    where upper(btrim(collaborator_invite_code)) = upper(btrim(p_code)) and status = 'active';
  if v_company.id is null then
    raise exception 'Código de convite não encontrado ou inativo.';
  end if;

  -- "p." é obrigatório: sem ele, "company_id" fica ambíguo com a coluna de
  -- retorno da função e o Postgres recusa (o convite nunca funcionava).
  select count(*) into v_seats_used from public.profiles p where p.company_id = v_company.id and p.company_role = 'collaborator';
  if v_seats_used >= v_company.seats_limit then
    raise exception 'Essa empresa já atingiu o limite de % colaboradores.', v_company.seats_limit;
  end if;

  update public.profiles set company_id = v_company.id, company_role = 'collaborator' where id = auth.uid();
  perform public.log_audit(v_company.id, 'collaborator_joined', jsonb_build_object('user_id', auth.uid()));
  return query select v_company.id, v_company.name;
end;
$$;

grant execute on function public.redeem_license_key(text) to authenticated;
grant execute on function public.redeem_invite_code(text) to authenticated;

-- A policy "profiles_self" (mais acima) permite update em QUALQUER coluna
-- da própria linha — incluindo is_platform_admin, company_id e
-- company_role. RLS protege linha, não coluna: sem isto, uma pessoa
-- logada conseguiria se promover a admin da plataforma ou trocar de
-- empresa sozinha com uma chamada direta à API, sem passar pela tela de
-- ativação. As únicas formas válidas de mudar esses três campos passam a
-- ser: redeem_license_key, redeem_invite_code, remove_collaborator (todas
-- security definer, abaixo) ou o próprio SQL Editor.
revoke update (is_platform_admin, company_id, company_role) on public.profiles from authenticated;

create or replace function public.remove_collaborator(p_collaborator_id uuid)
returns void language plpgsql security definer as $$
declare
  v_caller_company uuid;
  v_caller_role text;
  v_target_company uuid;
begin
  select company_id, company_role into v_caller_company, v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role != 'company_admin' then
    raise exception 'Somente administradores da empresa podem remover colaboradores.';
  end if;

  select company_id into v_target_company from public.profiles where id = p_collaborator_id;
  if v_target_company is null or v_target_company != v_caller_company then
    raise exception 'Esse colaborador não pertence à sua empresa.';
  end if;

  update public.profiles set company_id = null, company_role = null where id = p_collaborator_id;
end;
$$;

grant execute on function public.remove_collaborator(uuid) to authenticated;

-- services / assignments / api_keys / crm_integrations: escopo por empresa
drop policy if exists services_company_scope on public.services;
create policy services_company_scope on public.services
  for all using (company_id = public.my_company_id() or public.is_platform_admin())
  with check (company_id = public.my_company_id() or public.is_platform_admin());

drop policy if exists assignments_company_scope on public.assignments;
create policy assignments_company_scope on public.assignments
  for all using (company_id = public.my_company_id() or public.is_platform_admin())
  with check (company_id = public.my_company_id() or public.is_platform_admin());

drop policy if exists api_keys_company_scope on public.api_keys;
create policy api_keys_company_scope on public.api_keys
  for all using (company_id = public.my_company_id() or public.is_platform_admin())
  with check (company_id = public.my_company_id() or public.is_platform_admin());

drop policy if exists crm_integrations_company_scope on public.crm_integrations;
create policy crm_integrations_company_scope on public.crm_integrations
  for all using (company_id = public.my_company_id() or public.is_platform_admin())
  with check (company_id = public.my_company_id() or public.is_platform_admin());

-- profiles: dono vê/edita o próprio; company_admin vê/edita quem é da mesma empresa;
-- platform_admin vê/edita todo mundo. (Ajuste conforme as policies que você já tiver.)
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_company_admin_scope on public.profiles;
create policy profiles_company_admin_scope on public.profiles
  for all using (
    company_id = public.my_company_id()
    and public.my_company_role() = 'company_admin'
  )
  with check (
    company_id = public.my_company_id()
    and public.my_company_role() = 'company_admin'
  );

drop policy if exists profiles_platform_admin_all on public.profiles;
create policy profiles_platform_admin_all on public.profiles
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- =====================================================================
-- Virar platform admin (troque o e-mail) — é o "super admin" da plataforma,
-- separado de is_admin (que era do modelo antigo)
-- =====================================================================
-- update public.profiles set is_platform_admin = true where email = 'seu-email-aqui@exemplo.com';

-- =====================================================================
-- Criar a primeira empresa de teste (opcional, troque os valores)
-- =====================================================================
-- insert into public.companies (name, license_key, collaborator_invite_code, seats_limit)
-- values ('Empresa Teste', 'LICENCA-TESTE-0001', 'CONVITE-TESTE-0001', 10);

-- =====================================================================
-- NOTIFICAÇÕES — nova designação, início/conclusão de atendimento, e
-- possível desvio de rota. Geradas automaticamente por gatilhos no banco
-- (funcionam mesmo que ninguém esteja com o app aberto na hora do evento).
-- =====================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  message text,
  assignment_id uuid references public.assignments(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications(user_id, read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Qualquer pessoa da empresa pode gerar uma notificação pra outra pessoa da
-- MESMA empresa (é o que permite o colaborador avisar o admin quando sai do
-- trajeto, por exemplo) — mas nunca pra fora da própria empresa.
drop policy if exists notifications_insert_within_company on public.notifications;
create policy notifications_insert_within_company on public.notifications
  for insert with check (company_id = public.my_company_id());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Nova designação → avisa o colaborador
create or replace function public.notify_new_assignment()
returns trigger language plpgsql security definer as $$
begin
  insert into public.notifications (company_id, user_id, type, title, message, assignment_id)
  values (new.company_id, new.collaborator_id, 'new_assignment',
    'Nova designação', 'Você tem um novo atendimento agendado.', new.id);
  return new;
end;
$$;

drop trigger if exists trg_notify_new_assignment on public.assignments;
create trigger trg_notify_new_assignment
  after insert on public.assignments
  for each row execute function public.notify_new_assignment();

-- Início/conclusão de atendimento → avisa os admins da empresa
create or replace function public.notify_assignment_status_change()
returns trigger language plpgsql security definer as $$
declare
  admin_id uuid;
  collaborator_name text;
begin
  if new.status = old.status then return new; end if;
  if new.status not in ('in_progress', 'completed') then return new; end if;

  select name into collaborator_name from public.profiles where id = new.collaborator_id;

  for admin_id in
    select id from public.profiles where company_id = new.company_id and company_role = 'company_admin'
  loop
    insert into public.notifications (company_id, user_id, type, title, message, assignment_id)
    values (
      new.company_id, admin_id,
      case when new.status = 'in_progress' then 'assignment_started' else 'assignment_completed' end,
      case when new.status = 'in_progress' then 'Atendimento iniciado' else 'Atendimento concluído' end,
      coalesce(collaborator_name, 'Um colaborador') ||
        case when new.status = 'in_progress' then ' iniciou um atendimento.' else ' concluiu um atendimento.' end,
      new.id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_assignment_status on public.assignments;
create trigger trg_notify_assignment_status
  after update on public.assignments
  for each row execute function public.notify_assignment_status_change();

-- Chamada pelo app quando detecta que o colaborador saiu do trajeto previsto
-- (o cálculo da rota é feito no navegador; esta função só cuida de avisar
-- os admins da empresa quando isso é detectado).
create or replace function public.notify_off_route(p_assignment_id uuid)
returns void language plpgsql security definer as $$
declare
  v_company_id uuid;
  v_collaborator_id uuid;
  v_collaborator_name text;
  admin_id uuid;
begin
  select company_id, collaborator_id into v_company_id, v_collaborator_id
  from public.assignments where id = p_assignment_id;

  if v_company_id is null then return; end if;

  -- Só quem está de fato realizando esse atendimento pode disparar esse
  -- aviso — sem isso, qualquer pessoa logada (de qualquer empresa) poderia
  -- chamar esta função com o id de uma designação alheia e gerar
  -- notificações falsas pros admins de outra empresa.
  if v_collaborator_id != auth.uid() then
    return;
  end if;

  select name into v_collaborator_name from public.profiles where id = v_collaborator_id;

  for admin_id in
    select id from public.profiles where company_id = v_company_id and company_role = 'company_admin'
  loop
    insert into public.notifications (company_id, user_id, type, title, message, assignment_id)
    values (v_company_id, admin_id, 'off_route', 'Possível desvio de rota',
      coalesce(v_collaborator_name, 'O colaborador') || ' parece ter saído do trajeto previsto.',
      p_assignment_id);
  end loop;
end;
$$;

grant execute on function public.notify_off_route(uuid) to authenticated;

-- =====================================================================
-- CHAT — conversa entre um colaborador e os admins da empresa dele. Uma
-- "sala" por colaborador; todos os admins da empresa compartilham a mesma
-- conversa com aquele colaborador (como uma caixa de entrada compartilhada,
-- não uma conversa 1-a-1 travada com um admin específico).
-- =====================================================================

-- Chave simétrica aleatória por sala, gerada uma vez no primeiro uso pelo
-- navegador de quem abrir o chat primeiro. Mesmo escopo de RLS que
-- chat_messages: quem consegue ler as mensagens de uma sala também
-- consegue ler a chave dela (é o que permite decifrar) — quem não tem
-- acesso àquela sala não lê nem a chave nem as mensagens.
create table if not exists public.chat_keys (
  collaborator_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  key_b64 text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  collaborator_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now(),
  read_by_admin boolean not null default false,
  read_by_collaborator boolean not null default false
);

create index if not exists chat_messages_room_idx on public.chat_messages(collaborator_id, created_at);

alter table public.chat_keys enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_keys_room_access on public.chat_keys;
create policy chat_keys_room_access on public.chat_keys
  for all using (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  )
  with check (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

drop policy if exists chat_messages_read_update on public.chat_messages;
create policy chat_messages_read_update on public.chat_messages
  for select using (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

drop policy if exists chat_messages_mark_read on public.chat_messages;
create policy chat_messages_mark_read on public.chat_messages
  for update using (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  )
  with check (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

-- Insert exige, além de ter acesso à sala, que a mensagem seja enviada em
-- nome de quem está realmente logado — impede alguém de inserir uma
-- mensagem se passando por outra pessoa da mesma empresa.
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (
    sender_id = auth.uid()
    and (
      collaborator_id = auth.uid()
      or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
      or public.is_platform_admin()
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- Nova mensagem → avisa quem não mandou (nunca inclui o conteúdo da
-- mensagem na notificação — ela está cifrada, e mesmo que não estivesse,
-- colocar o texto em claro numa notificação anularia o propósito de cifrar).
-- Inclui o PAPEL de quem mandou (colaborador / administrador) além do nome
-- — evita qualquer confusão sobre quem realmente enviou, mesmo que nomes de
-- contas de teste coincidam ou sejam parecidos.
create or replace function public.notify_new_chat_message()
returns trigger language plpgsql security definer as $$
declare
  admin_id uuid;
  sender_name text;
begin
  select name into sender_name from public.profiles where id = new.sender_id;

  if new.sender_id = new.collaborator_id then
    for admin_id in
      select id from public.profiles where company_id = new.company_id and company_role = 'company_admin'
    loop
      insert into public.notifications (company_id, user_id, type, title, message)
      values (new.company_id, admin_id, 'new_message',
        'Nova mensagem', coalesce(sender_name, 'Um colaborador') || ' (colaborador) enviou uma mensagem no chat.');
    end loop;
  else
    insert into public.notifications (company_id, user_id, type, title, message)
    values (new.company_id, new.collaborator_id, 'new_message',
      'Nova mensagem', coalesce(sender_name, 'Um administrador') || ' (administrador da empresa) enviou uma mensagem no chat.');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_chat_message on public.chat_messages;
create trigger trg_notify_new_chat_message
  after insert on public.chat_messages
  for each row execute function public.notify_new_chat_message();

-- =====================================================================
-- DESIGNAÇÕES RECORRENTES — várias linhas geradas de uma vez, ligadas por
-- um id de grupo (mais simples e mais robusto que um motor de recorrência
-- que fica gerando ocorrências futuras sozinho).
-- =====================================================================
alter table public.assignments add column if not exists recurrence_group_id uuid;
create index if not exists assignments_recurrence_idx on public.assignments(recurrence_group_id);

-- =====================================================================
-- FOTOS DE ANTES/DEPOIS E ASSINATURA DO CLIENTE
-- =====================================================================
create table if not exists public.assignment_photos (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('before', 'after', 'signature')),
  url text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.assignment_photos enable row level security;
drop policy if exists assignment_photos_company_scope on public.assignment_photos;
create policy assignment_photos_company_scope on public.assignment_photos
  for all using (company_id = public.my_company_id() or public.is_platform_admin())
  with check (company_id = public.my_company_id() or public.is_platform_admin());

-- Bucket de storage pra guardar os arquivos (privado — só acessível via URL
-- assinada, ou por quem tem RLS de acesso, nunca público direto).
insert into storage.buckets (id, name, public) values ('assignment-photos', 'assignment-photos', false)
  on conflict (id) do nothing;

-- Convenção de caminho: assignment-photos/<assignment_id>/<arquivo> — a
-- policy usa o primeiro segmento da pasta pra achar a designação e checar
-- se quem está pedindo pertence à empresa dona dela.
drop policy if exists assignment_photos_storage_access on storage.objects;
create policy assignment_photos_storage_access on storage.objects
  for all using (
    bucket_id = 'assignment-photos'
    and exists (
      select 1 from public.assignments a
      where a.id::text = (storage.foldername(name))[1]
      and (a.company_id = public.my_company_id() or public.is_platform_admin())
    )
  )
  with check (
    bucket_id = 'assignment-photos'
    and exists (
      select 1 from public.assignments a
      where a.id::text = (storage.foldername(name))[1]
      and (a.company_id = public.my_company_id() or public.is_platform_admin())
    )
  );

-- =====================================================================
-- DISPONIBILIDADE DO COLABORADOR (folgas / períodos indisponíveis)
-- =====================================================================
create table if not exists public.collaborator_time_off (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.collaborator_time_off enable row level security;
drop policy if exists collaborator_time_off_scope on public.collaborator_time_off;
create policy collaborator_time_off_scope on public.collaborator_time_off
  for all using (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  )
  with check (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

-- =====================================================================
-- PAPEL DE SUPERVISOR — enxerga e gerencia só os colaboradores designados
-- a ele, não a empresa inteira (diferente do company_admin).
-- =====================================================================
alter table public.profiles drop constraint if exists profiles_company_role_check;
alter table public.profiles add constraint profiles_company_role_check
  check (company_role in ('company_admin', 'collaborator', 'supervisor'));
alter table public.profiles add column if not exists supervised_by uuid references public.profiles(id);

create or replace function public.my_supervised_ids()
returns setof uuid language sql stable security definer as $$
  select id from public.profiles where supervised_by = auth.uid();
$$;

drop policy if exists profiles_supervisor_scope on public.profiles;
create policy profiles_supervisor_scope on public.profiles
  for select using (supervised_by = auth.uid());

drop policy if exists assignments_supervisor_scope on public.assignments;
create policy assignments_supervisor_scope on public.assignments
  for all using (collaborator_id in (select public.my_supervised_ids()))
  with check (collaborator_id in (select public.my_supervised_ids()));

-- Chat: supervisor também pode conversar com quem ele supervisiona.
drop policy if exists chat_keys_room_access on public.chat_keys;
create policy chat_keys_room_access on public.chat_keys
  for all using (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or collaborator_id in (select public.my_supervised_ids())
    or public.is_platform_admin()
  )
  with check (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or collaborator_id in (select public.my_supervised_ids())
    or public.is_platform_admin()
  );

drop policy if exists chat_messages_read_update on public.chat_messages;
create policy chat_messages_read_update on public.chat_messages
  for select using (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or collaborator_id in (select public.my_supervised_ids())
    or public.is_platform_admin()
  );

drop policy if exists chat_messages_mark_read on public.chat_messages;
create policy chat_messages_mark_read on public.chat_messages
  for update using (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or collaborator_id in (select public.my_supervised_ids())
    or public.is_platform_admin()
  )
  with check (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or collaborator_id in (select public.my_supervised_ids())
    or public.is_platform_admin()
  );

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (
    sender_id = auth.uid()
    and (
      collaborator_id = auth.uid()
      or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
      or collaborator_id in (select public.my_supervised_ids())
      or public.is_platform_admin()
    )
  );

-- Só o admin da empresa pode promover/rebaixar supervisor ou trocar quem
-- supervisiona quem (mesmo motivo de remove_collaborator: company_role e
-- supervised_by não podem ser editados direto pelo usuário comum).
create or replace function public.set_collaborator_role(p_collaborator_id uuid, p_role text, p_supervised_by uuid default null)
returns void language plpgsql security definer as $$
declare
  v_caller_company uuid;
  v_caller_role text;
  v_target_company uuid;
begin
  select company_id, company_role into v_caller_company, v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role != 'company_admin' then
    raise exception 'Somente administradores da empresa podem alterar papéis.';
  end if;
  if p_role not in ('collaborator', 'supervisor') then
    raise exception 'Papel inválido.';
  end if;

  select company_id into v_target_company from public.profiles where id = p_collaborator_id;
  if v_target_company is null or v_target_company != v_caller_company then
    raise exception 'Essa pessoa não pertence à sua empresa.';
  end if;

  -- Confirma que o supervisor indicado é, de fato, um supervisor da mesma
  -- empresa — sem isso, um valor manipulado aqui poderia vazar o acesso de
  -- leitura desse colaborador pra alguém de fora da empresa (a policy
  -- profiles_supervisor_scope libera leitura baseada só em supervised_by).
  if p_supervised_by is not null then
    if not exists (
      select 1 from public.profiles
      where id = p_supervised_by and company_id = v_caller_company and company_role = 'supervisor'
    ) then
      raise exception 'O supervisor indicado não é válido para esta empresa.';
    end if;
  end if;

  update public.profiles
  set company_role = p_role,
      supervised_by = case when p_role = 'collaborator' then p_supervised_by else null end
  where id = p_collaborator_id;

  perform public.log_audit(v_caller_company, 'collaborator_role_changed',
    jsonb_build_object('collaborator_id', p_collaborator_id, 'new_role', p_role));
end;
$$;

grant execute on function public.set_collaborator_role(uuid, text, uuid) to authenticated;

-- =====================================================================
-- LOG DE AUDITORIA — quem fez o quê. Alimentado pelas próprias funções do
-- banco (não pelo cliente direto), então não dá pra forjar uma entrada.
-- =====================================================================
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_company_idx on public.audit_log(company_id, created_at desc);

alter table public.audit_log enable row level security;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select using (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

create or replace function public.log_audit(p_company_id uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer as $$
begin
  insert into public.audit_log (company_id, actor_id, action, details)
  values (p_company_id, auth.uid(), p_action, p_details);
end;
$$;

-- Só deve ser chamada de DENTRO de outras funções do banco (remove_collaborator,
-- set_collaborator_role, os gatilhos de auditoria) — nunca direto pelo
-- cliente, senão qualquer pessoa logada poderia forjar entradas falsas no
-- log de auditoria de qualquer empresa. Funções "security definer" chamando
-- esta por dentro continuam funcionando mesmo com o revoke abaixo, porque
-- nesse caso quem está "executando" é o dono da função (privilégio elevado),
-- não o papel do usuário comum.
revoke execute on function public.log_audit(uuid, text, jsonb) from public;

create or replace function public.audit_assignment_cancel()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform public.log_audit(new.company_id, 'assignment_cancelled', jsonb_build_object('assignment_id', new.id));
  end if;
  -- Reatribuição (trocar o colaborador responsável) também vira um evento
  -- de auditoria, junto com o cancelamento.
  if new.collaborator_id is distinct from old.collaborator_id then
    perform public.log_audit(new.company_id, 'assignment_reassigned', jsonb_build_object('assignment_id', new.id));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_assignment_cancel on public.assignments;
create trigger trg_audit_assignment_cancel
  after update on public.assignments
  for each row execute function public.audit_assignment_cancel();

-- Nova designação criada — sem isso, o log ficava praticamente vazio no dia
-- a dia normal (cancelamento é raro; criar designação é o que mais acontece).
create or replace function public.audit_assignment_insert()
returns trigger language plpgsql security definer as $$
begin
  perform public.log_audit(new.company_id, 'assignment_created', jsonb_build_object('assignment_id', new.id));
  return new;
end;
$$;

drop trigger if exists trg_audit_assignment_insert on public.assignments;
create trigger trg_audit_assignment_insert
  after insert on public.assignments
  for each row execute function public.audit_assignment_insert();

-- Serviço criado ou editado
create or replace function public.audit_service_change()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(new.company_id, 'service_created', jsonb_build_object('name', new.name));
  else
    perform public.log_audit(new.company_id, 'service_updated', jsonb_build_object('name', new.name));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_service_change on public.services;
create trigger trg_audit_service_change
  after insert or update on public.services
  for each row execute function public.audit_service_change();

create or replace function public.audit_company_status()
returns trigger language plpgsql security definer as $$
begin
  if new.status is distinct from old.status then
    perform public.log_audit(new.id, 'company_status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_company_status on public.companies;
create trigger trg_audit_company_status
  after update on public.companies
  for each row execute function public.audit_company_status();

-- remove_collaborator também registra no log (redefinida aqui pra incluir isso —
-- mesma lógica de antes, só com o log adicionado no fim)
create or replace function public.remove_collaborator(p_collaborator_id uuid)
returns void language plpgsql security definer as $$
declare
  v_caller_company uuid;
  v_caller_role text;
  v_target_company uuid;
begin
  select company_id, company_role into v_caller_company, v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role != 'company_admin' then
    raise exception 'Somente administradores da empresa podem remover colaboradores.';
  end if;

  select company_id into v_target_company from public.profiles where id = p_collaborator_id;
  if v_target_company is null or v_target_company != v_caller_company then
    raise exception 'Esse colaborador não pertence à sua empresa.';
  end if;

  update public.profiles set company_id = null, company_role = null, supervised_by = null where id = p_collaborator_id;
  perform public.log_audit(v_caller_company, 'collaborator_removed', jsonb_build_object('collaborator_id', p_collaborator_id));
end;
$$;

-- =====================================================================
-- AVALIAÇÃO DO CLIENTE — link público (sem login) pra avaliar um
-- atendimento concluído, usando um token aleatório em vez de autenticação.
-- =====================================================================
alter table public.assignments add column if not exists rating_token uuid default gen_random_uuid();
alter table public.assignments add column if not exists customer_rating smallint check (customer_rating between 1 and 5);
alter table public.assignments add column if not exists customer_feedback text;
alter table public.assignments add column if not exists rated_at timestamptz;

create or replace function public.get_rating_context(p_token uuid)
returns table(service_name text, scheduled_start timestamptz, already_rated boolean)
language plpgsql security definer as $$
begin
  return query
  select s.name, a.scheduled_start, (a.customer_rating is not null)
  from public.assignments a join public.services s on s.id = a.service_id
  where a.rating_token = p_token;
end;
$$;

create or replace function public.submit_rating(p_token uuid, p_rating int, p_feedback text default null)
returns void language plpgsql security definer as $$
declare
  v_id uuid;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'A nota precisa ser de 1 a 5.';
  end if;

  select id into v_id from public.assignments
  where rating_token = p_token and status = 'completed' and customer_rating is null;

  if v_id is null then
    raise exception 'Link inválido, expirado, ou este atendimento já foi avaliado.';
  end if;

  update public.assignments set customer_rating = p_rating, customer_feedback = p_feedback, rated_at = now()
  where id = v_id;
end;
$$;

-- Estas duas rodam sem ninguém logado (é um link que o cliente final abre) —
-- por isso o grant inclui "anon", não só "authenticated".
grant execute on function public.get_rating_context(uuid) to anon, authenticated;
grant execute on function public.submit_rating(uuid, int, text) to anon, authenticated;

-- =====================================================================
-- NOTIFICAÇÕES PUSH (de verdade — chegam com o app fechado/celular travado)
-- =====================================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_self on public.push_subscriptions;
create policy push_subscriptions_self on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================================
-- FASE 0 — CORREÇÕES DE SEGURANÇA (03/10/2026)
-- Testadas em supabase/tests (rode supabase/tests/run.sh).
-- =====================================================================
--
-- Por que gatilhos e não "revoke update (coluna)": o Supabase dá
-- "grant all" na tabela inteira para o papel authenticated, e no Postgres
-- um revoke por coluna NÃO tem efeito quando existe grant na tabela.
-- Ou seja, o revoke da seção de segurança anterior nunca funcionou: qualquer
-- pessoa logada conseguia se promover a admin da plataforma. Os gatilhos
-- abaixo valem independentemente dos grants.
--
-- Regra geral dos gatilhos: só se aplicam a chamadas vindas do app
-- (current_user = authenticated/anon). Funções "security definer" do banco
-- (redeem_license_key, set_collaborator_role...) e o SQL Editor rodam como
-- dono das tabelas e continuam funcionando normalmente.

create or replace function public.is_client_call()
returns boolean language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

-- ---------------------------------------------------------------------
-- PROFILES: ninguém altera o próprio papel, empresa ou supervisor
-- ---------------------------------------------------------------------
create or replace function public.guard_profiles()
returns trigger language plpgsql as $$
begin
  if not public.is_client_call() or public.is_platform_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.is_platform_admin, false) or new.company_id is not null
       or new.company_role is not null or new.supervised_by is not null then
      raise exception 'Perfil novo não pode vir com papel, empresa ou supervisor.';
    end if;
  else
    if new.is_platform_admin is distinct from old.is_platform_admin
       or new.company_id is distinct from old.company_id
       or new.company_role is distinct from old.company_role
       or new.supervised_by is distinct from old.supervised_by then
      raise exception 'Papel, empresa e supervisor só mudam pelas funções do sistema.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profiles on public.profiles;
create trigger trg_guard_profiles before insert or update on public.profiles
  for each row execute function public.guard_profiles();

-- Perfis não são apagados pelo app (remover colaborador = desvincular,
-- via remove_collaborator). As policies "for all" antigas permitiam delete.
drop policy if exists profiles_self on public.profiles;
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid());
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
  for insert with check (id = auth.uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_company_admin_scope on public.profiles;
drop policy if exists profiles_company_admin_select on public.profiles;
create policy profiles_company_admin_select on public.profiles
  for select using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin');
drop policy if exists profiles_company_admin_update on public.profiles;
create policy profiles_company_admin_update on public.profiles
  for update using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
  with check (company_id = public.my_company_id() and public.my_company_role() = 'company_admin');

-- ---------------------------------------------------------------------
-- COMPANIES: licença (vagas, status, chaves) só muda pela plataforma
-- ---------------------------------------------------------------------
create or replace function public.guard_companies()
returns trigger language plpgsql as $$
begin
  if not public.is_client_call() or public.is_platform_admin() then
    return new;
  end if;
  if new.seats_limit is distinct from old.seats_limit
     or new.status is distinct from old.status
     or new.license_key is distinct from old.license_key
     or new.collaborator_invite_code is distinct from old.collaborator_invite_code
     or new.notes is distinct from old.notes then
    raise exception 'Somente a plataforma altera dados da licença.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_companies on public.companies;
create trigger trg_guard_companies before update on public.companies
  for each row execute function public.guard_companies();

drop policy if exists companies_self_update_name on public.companies;
create policy companies_self_update_name on public.companies
  for update using (id = public.my_company_id() and public.my_company_role() = 'company_admin')
  with check (id = public.my_company_id() and public.my_company_role() = 'company_admin');

-- ---------------------------------------------------------------------
-- ASSIGNMENTS: motoboy vê e atualiza só as próprias, e só o status
-- ---------------------------------------------------------------------
drop policy if exists assignments_company_scope on public.assignments;

drop policy if exists assignments_platform_all on public.assignments;
create policy assignments_platform_all on public.assignments
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists assignments_admin_scope on public.assignments;
create policy assignments_admin_scope on public.assignments
  for all using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
  with check (company_id = public.my_company_id() and public.my_company_role() = 'company_admin');

drop policy if exists assignments_supervisor_scope on public.assignments;
create policy assignments_supervisor_scope on public.assignments
  for all using (
    company_id = public.my_company_id()
    and collaborator_id in (select public.my_supervised_ids())
  )
  with check (
    company_id = public.my_company_id()
    and collaborator_id in (select public.my_supervised_ids())
  );

drop policy if exists assignments_collaborator_select on public.assignments;
create policy assignments_collaborator_select on public.assignments
  for select using (collaborator_id = auth.uid());

drop policy if exists assignments_collaborator_update on public.assignments;
create policy assignments_collaborator_update on public.assignments
  for update using (collaborator_id = auth.uid()) with check (collaborator_id = auth.uid());

create or replace function public.guard_assignments_collaborator()
returns trigger language plpgsql as $$
begin
  if not public.is_client_call() or public.is_platform_admin()
     or public.my_company_role() in ('company_admin', 'supervisor') then
    return new;
  end if;
  -- Daqui pra baixo: é o próprio motoboy mexendo na designação dele.
  if (to_jsonb(new) - array['status', 'started_at', 'completed_at'])
     is distinct from (to_jsonb(old) - array['status', 'started_at', 'completed_at']) then
    raise exception 'O colaborador só pode atualizar o andamento do atendimento.';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'scheduled' and new.status in ('en_route', 'in_progress'))
    or (old.status = 'en_route' and new.status = 'in_progress')
    or (old.status = 'in_progress' and new.status = 'completed')
  ) then
    raise exception 'Mudança de status não permitida: % → %.', old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_assignments_collaborator on public.assignments;
create trigger trg_guard_assignments_collaborator before update on public.assignments
  for each row execute function public.guard_assignments_collaborator();

-- ---------------------------------------------------------------------
-- SERVICES: toda a empresa lê o catálogo; só o admin altera
-- ---------------------------------------------------------------------
drop policy if exists services_company_scope on public.services;
drop policy if exists services_company_read on public.services;
create policy services_company_read on public.services
  for select using (company_id = public.my_company_id() or public.is_platform_admin());
drop policy if exists services_admin_write on public.services;
create policy services_admin_write on public.services
  for all using (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

-- ---------------------------------------------------------------------
-- CHAVES DE API E CRM: só o admin da empresa (e a plataforma)
-- ---------------------------------------------------------------------
drop policy if exists api_keys_company_scope on public.api_keys;
create policy api_keys_company_scope on public.api_keys
  for all using (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

drop policy if exists crm_integrations_company_scope on public.crm_integrations;
create policy crm_integrations_company_scope on public.crm_integrations
  for all using (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

-- ---------------------------------------------------------------------
-- FOTOS: quem enxerga a designação enxerga as fotos dela (a consulta em
-- assignments já passa pelas policies acima, então motoboy só vê as dele
-- e supervisor só as da equipe).
-- ---------------------------------------------------------------------
drop policy if exists assignment_photos_company_scope on public.assignment_photos;
create policy assignment_photos_company_scope on public.assignment_photos
  for all using (
    exists (select 1 from public.assignments a where a.id = assignment_id)
    and (company_id = public.my_company_id() or public.is_platform_admin())
  )
  with check (
    exists (select 1 from public.assignments a where a.id = assignment_id)
    and (company_id = public.my_company_id() or public.is_platform_admin())
  );

drop policy if exists assignment_photos_storage_access on storage.objects;
create policy assignment_photos_storage_access on storage.objects
  for all using (
    bucket_id = 'assignment-photos'
    and exists (
      select 1 from public.assignments a
      where a.id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'assignment-photos'
    and exists (
      select 1 from public.assignments a
      where a.id::text = (storage.foldername(name))[1]
    )
  );

-- =====================================================================
-- FASE 1 — ENTREGAS (pedidos, fila, bairros, saídas com várias paradas,
-- código de finalização, histórico de posições)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Liberações por empresa
-- feature_delivery_code / feature_branding: só a plataforma liga
-- strict_route_mode / off_route_meters: o admin da empresa escolhe
-- ---------------------------------------------------------------------
alter table public.companies add column if not exists feature_delivery_code boolean not null default false;
alter table public.companies add column if not exists feature_branding boolean not null default false;
alter table public.companies add column if not exists strict_route_mode boolean not null default false;
alter table public.companies add column if not exists off_route_meters integer not null default 250
  check (off_route_meters between 50 and 5000);
alter table public.companies add column if not exists next_order_number integer not null default 1;

create or replace function public.guard_companies()
returns trigger language plpgsql as $$
begin
  if not public.is_client_call() or public.is_platform_admin() then
    return new;
  end if;
  if new.seats_limit is distinct from old.seats_limit
     or new.status is distinct from old.status
     or new.license_key is distinct from old.license_key
     or new.collaborator_invite_code is distinct from old.collaborator_invite_code
     or new.notes is distinct from old.notes
     or new.feature_delivery_code is distinct from old.feature_delivery_code
     or new.feature_branding is distinct from old.feature_branding
     or new.next_order_number is distinct from old.next_order_number then
    raise exception 'Somente a plataforma altera dados da licença e as liberações.';
  end if;
  return new;
end;
$$;

-- Gestores de pedidos: admin da empresa e supervisor (despachante).
create or replace function public.is_order_manager()
returns boolean language sql stable security definer as $$
  select coalesce((select company_role in ('company_admin', 'supervisor')
                   from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- Bairros / zonas de entrega (taxa e tempo estimado)
-- ---------------------------------------------------------------------
create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  fee numeric(10,2) not null default 0,
  eta_minutes integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.delivery_zones enable row level security;

drop policy if exists delivery_zones_read on public.delivery_zones;
create policy delivery_zones_read on public.delivery_zones
  for select using (company_id = public.my_company_id() or public.is_platform_admin());
drop policy if exists delivery_zones_write on public.delivery_zones;
create policy delivery_zones_write on public.delivery_zones
  for all using (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

-- ---------------------------------------------------------------------
-- Clientes finais (endereço salvo para pedidos repetidos)
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  phone text,
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  lat double precision,
  lng double precision,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists customers_company_phone_idx on public.customers(company_id, phone);
alter table public.customers enable row level security;

drop policy if exists customers_managers on public.customers;
create policy customers_managers on public.customers
  for all using (
    (company_id = public.my_company_id() and public.is_order_manager())
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.my_company_id() and public.is_order_manager())
    or public.is_platform_admin()
  );

-- ---------------------------------------------------------------------
-- Saídas do motoboy (uma saída = uma ou mais paradas)
-- ---------------------------------------------------------------------
create table if not exists public.delivery_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  courier_id uuid not null references public.profiles(id),
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'finished', 'cancelled')),
  strict_route boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists delivery_runs_company_idx on public.delivery_runs(company_id, created_at desc);
create index if not exists delivery_runs_courier_idx on public.delivery_runs(courier_id, status);
alter table public.delivery_runs enable row level security;

-- Escrita só pelas funções abaixo (dispatch_run, start_run...). O app lê.
drop policy if exists delivery_runs_read on public.delivery_runs;
create policy delivery_runs_read on public.delivery_runs
  for select using (
    courier_id = auth.uid()
    or (company_id = public.my_company_id() and public.is_order_manager())
    or public.is_platform_admin()
  );

-- ---------------------------------------------------------------------
-- Pedidos
-- Fila: received → preparing → ready → on_route → delivered
--       (+ cancelled, problem)
-- ---------------------------------------------------------------------
create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  number integer,
  source text not null default 'balcao'
    check (source in ('balcao', 'telefone', 'whatsapp', 'ifood', 'outro')),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  lat double precision,
  lng double precision,
  zone_id uuid references public.delivery_zones(id) on delete set null,
  items text,
  subtotal numeric(10,2) not null default 0,
  delivery_fee numeric(10,2),
  total numeric(10,2) generated always as (subtotal + coalesce(delivery_fee, 0)) stored,
  payment_method text check (payment_method in ('dinheiro', 'cartao', 'pix', 'online')),
  change_for numeric(10,2),
  notes text,
  status text not null default 'received'
    check (status in ('received', 'preparing', 'ready', 'on_route', 'delivered', 'cancelled', 'problem')),
  problem_reason text,
  run_id uuid references public.delivery_runs(id) on delete set null,
  stop_sequence integer,
  courier_id uuid references public.profiles(id),
  route_choice smallint check (route_choice between 0 and 2),
  delivered_lat double precision,
  delivered_lng double precision,
  delivered_by_code boolean,
  forced_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  unique (company_id, number)
);
-- Entrega (sai com motoboy) ou pedido local (balcão: retirada/consumo na loja).
alter table public.delivery_orders add column if not exists order_type text not null default 'delivery'
  check (order_type in ('delivery', 'local'));
create index if not exists delivery_orders_company_status_idx on public.delivery_orders(company_id, status, created_at desc);
create index if not exists delivery_orders_run_idx on public.delivery_orders(run_id, stop_sequence);
create index if not exists delivery_orders_courier_idx on public.delivery_orders(courier_id, status);
alter table public.delivery_orders enable row level security;

drop policy if exists delivery_orders_managers on public.delivery_orders;
create policy delivery_orders_managers on public.delivery_orders
  for all using (
    (company_id = public.my_company_id() and public.is_order_manager())
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.my_company_id() and public.is_order_manager())
    or public.is_platform_admin()
  );

-- Motoboy só lê os pedidos que estão com ele. Não escreve direto: tudo
-- passa pelas funções start_run / complete_delivery / report_problem.
drop policy if exists delivery_orders_courier_read on public.delivery_orders;
create policy delivery_orders_courier_read on public.delivery_orders
  for select using (courier_id = auth.uid());

-- Número sequencial por empresa, bairro → zona e taxa automática.
create or replace function public.delivery_orders_before_insert()
returns trigger language plpgsql security definer as $$
declare
  v_zone record;
begin
  update public.companies set next_order_number = next_order_number + 1
    where id = new.company_id returning next_order_number - 1 into new.number;

  -- Pedido local (balcão): sem endereço, bairro, taxa de entrega nem rota.
  if new.order_type = 'local' then
    new.address_street := null; new.address_number := null; new.address_complement := null;
    new.address_neighborhood := null; new.address_city := null;
    new.lat := null; new.lng := null; new.zone_id := null; new.delivery_fee := null;
    return new;
  end if;

  if new.zone_id is null and new.address_neighborhood is not null then
    select id into new.zone_id from public.delivery_zones
      where company_id = new.company_id and active
        and lower(unaccent_simple(name)) = lower(unaccent_simple(new.address_neighborhood))
      limit 1;
  end if;
  if new.delivery_fee is null and new.zone_id is not null then
    select fee into new.delivery_fee from public.delivery_zones where id = new.zone_id;
  end if;

  return new;
end;
$$;

-- Separado do gatilho acima porque precisa rodar SEM security definer:
-- só assim is_client_call() enxerga que a chamada veio do app.
create or replace function public.delivery_orders_sanitize_insert()
returns trigger language plpgsql as $$
begin
  -- Campos de entrega nunca vêm preenchidos do app na criação.
  if public.is_client_call() and not public.is_platform_admin() then
    new.status := case when new.status in ('received', 'preparing', 'ready') then new.status else 'received' end;
    new.run_id := null; new.courier_id := null; new.stop_sequence := null;
    new.delivered_at := null; new.dispatched_at := null; new.forced_reason := null;
    new.delivered_by_code := null; new.route_choice := null;
    new.courier_fee := null;
    new.created_by := auth.uid();
    -- Cliente de outra empresa não entra (o RLS de customers só mostra os da própria).
    if new.customer_id is not null
       and not exists (select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id) then
      new.customer_id := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_delivery_orders_sanitize_insert on public.delivery_orders;
create trigger trg_delivery_orders_sanitize_insert before insert on public.delivery_orders
  for each row execute function public.delivery_orders_sanitize_insert();

-- Remove acentos sem depender da extensão unaccent.
create or replace function public.unaccent_simple(t text)
returns text language sql immutable as $$
  select translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')
$$;

drop trigger if exists trg_delivery_orders_before_insert on public.delivery_orders;
create trigger trg_delivery_orders_before_insert before insert on public.delivery_orders
  for each row execute function public.delivery_orders_before_insert();

-- Pelo app, gestor só move o pedido na fila (recebido/preparo/pronto) ou
-- cancela. Saída, entrega e "forçar entrega" passam pelas funções, que
-- registram quem fez e quando.
create or replace function public.guard_delivery_orders()
returns trigger language plpgsql as $$
begin
  if not public.is_client_call() or public.is_platform_admin() then
    return new;
  end if;
  if new.number is distinct from old.number
     or new.company_id is distinct from old.company_id
     or new.run_id is distinct from old.run_id
     or new.courier_id is distinct from old.courier_id
     or new.stop_sequence is distinct from old.stop_sequence
     or new.delivered_at is distinct from old.delivered_at
     or new.delivered_by_code is distinct from old.delivered_by_code
     or new.forced_reason is distinct from old.forced_reason
     or new.courier_fee is distinct from old.courier_fee then
    raise exception 'Use as funções de despacho/entrega para alterar estes campos.';
  end if;
  if new.order_type is distinct from old.order_type then
    raise exception 'O tipo do pedido (entrega ou local) não muda depois de criado.';
  end if;
  -- Pedido encerrado não muda valores nem forma de pagamento (caixa e acerto dependem deles).
  if old.status in ('delivered', 'cancelled')
     and (new.subtotal, new.payment_method, new.delivery_fee, new.change_for, new.items, new.customer_id)
         is distinct from (old.subtotal, old.payment_method, old.delivery_fee, old.change_for, old.items, old.customer_id) then
    raise exception 'Pedido encerrado não pode ser alterado.';
  end if;
  if new.order_type = 'local' then new.delivery_fee := null; end if;
  -- Pedido com produtos: o valor dos itens vem do cardápio (set_order_items).
  if new.subtotal is distinct from old.subtotal
     and exists (select 1 from public.delivery_order_items i where i.order_id = old.id) then
    raise exception 'O valor dos itens vem dos produtos do pedido.';
  end if;
  if new.status is distinct from old.status then
    if old.status in ('delivered', 'cancelled') then
      raise exception 'Pedido já encerrado.';
    end if;
    if new.status not in ('received', 'preparing', 'ready', 'cancelled') then
      raise exception 'Use as funções de despacho/entrega para mudar para %.', new.status;
    end if;
    if old.run_id is not null then
      raise exception 'Pedido está numa saída de motoboy; tire-o da saída primeiro.';
    end if;
    if new.status = 'ready' and new.ready_at is null then new.ready_at := now(); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_delivery_orders on public.delivery_orders;
create trigger trg_guard_delivery_orders before update on public.delivery_orders
  for each row execute function public.guard_delivery_orders();

-- ---------------------------------------------------------------------
-- Código de finalização (tabela separada: o motoboy não consegue ler)
-- ---------------------------------------------------------------------
create table if not exists public.order_delivery_codes (
  order_id uuid primary key references public.delivery_orders(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  failed_attempts integer not null default 0,
  locked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.order_delivery_codes enable row level security;

drop policy if exists order_delivery_codes_managers on public.order_delivery_codes;
create policy order_delivery_codes_managers on public.order_delivery_codes
  for select using (
    (company_id = public.my_company_id() and public.is_order_manager())
    or public.is_platform_admin()
  );

create or replace function public.delivery_orders_after_insert()
returns trigger language plpgsql security definer as $$
begin
  if new.order_type = 'local' then return new; end if;
  insert into public.order_delivery_codes (order_id, company_id, code)
  values (new.id, new.company_id, lpad((floor(random() * 10000))::int::text, 4, '0'))
  on conflict (order_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_delivery_orders_after_insert on public.delivery_orders;
create trigger trg_delivery_orders_after_insert after insert on public.delivery_orders
  for each row execute function public.delivery_orders_after_insert();

-- Liberar também o código: o admin precisa vê-lo para mandar ao cliente.
-- (Desbloqueia a parada travada por tentativas erradas.)
create or replace function public.unlock_delivery_code(p_order_id uuid)
returns void language plpgsql security definer as $$
begin
  if not exists (select 1 from public.delivery_orders o where o.id = p_order_id
                 and o.company_id = public.my_company_id() and public.is_order_manager()) then
    raise exception 'Pedido não encontrado.';
  end if;
  update public.order_delivery_codes set locked = false, failed_attempts = 0 where order_id = p_order_id;
end;
$$;
grant execute on function public.unlock_delivery_code(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Despacho: cria uma saída com as paradas na ordem informada
-- ---------------------------------------------------------------------
create or replace function public.notify_company_managers(p_company uuid, p_type text, p_title text, p_message text)
returns void language sql security definer as $$
  insert into public.notifications (company_id, user_id, type, title, message)
  select p_company, p.id, p_type, p_title, p_message
  from public.profiles p
  where p.company_id = p_company and p.company_role in ('company_admin', 'supervisor');
$$;
revoke execute on function public.notify_company_managers(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.check_courier(p_courier uuid)
returns void language plpgsql security definer as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_courier and p.company_id = public.my_company_id()
      and p.company_role = 'collaborator'
      and (public.my_company_role() = 'company_admin' or p.supervised_by = auth.uid())
  ) then
    raise exception 'Motoboy inválido para esta empresa.';
  end if;
end;
$$;
revoke execute on function public.check_courier(uuid) from public, anon, authenticated;

create or replace function public.dispatch_run(p_courier uuid, p_order_ids uuid[])
returns uuid language plpgsql security definer as $$
declare
  v_company uuid := public.my_company_id();
  v_run uuid;
  v_strict boolean;
  i int;
begin
  if not public.is_order_manager() then raise exception 'Sem permissão para despachar.'; end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then raise exception 'Escolha ao menos um pedido.'; end if;
  perform public.check_courier(p_courier);

  if exists (select 1 from public.delivery_orders o where o.id = any(p_order_ids) and o.order_type = 'local') then
    raise exception 'Pedido local não sai com motoboy.';
  end if;
  if (select count(distinct o.id) from public.delivery_orders o
      where o.id = any(p_order_ids) and o.company_id = v_company
        and o.status in ('received', 'preparing', 'ready') and o.run_id is null)
     <> array_length(p_order_ids, 1) then
    raise exception 'Algum pedido não está disponível para despacho.';
  end if;

  select strict_route_mode into v_strict from public.companies where id = v_company;
  insert into public.delivery_runs (company_id, courier_id, created_by, strict_route)
    values (v_company, p_courier, auth.uid(), v_strict) returning id into v_run;

  for i in 1 .. array_length(p_order_ids, 1) loop
    update public.delivery_orders set run_id = v_run, courier_id = p_courier, stop_sequence = i,
      courier_fee = public.courier_order_fee(p_courier)
      where id = p_order_ids[i];
  end loop;

  insert into public.notifications (company_id, user_id, type, title, message)
    values (v_company, p_courier, 'new_run', 'Nova saída de entrega',
            array_length(p_order_ids, 1) || ' parada(s) aguardando você.');
  return v_run;
end;
$$;
grant execute on function public.dispatch_run(uuid, uuid[]) to authenticated;

-- Reorganiza uma saída ainda não encerrada: nova lista/ordem de paradas
-- (pedidos tirados voltam para a fila) e, opcionalmente, outro motoboy.
-- Paradas já entregues continuam na saída.
create or replace function public.update_run(p_run uuid, p_order_ids uuid[], p_courier uuid default null)
returns void language plpgsql security definer as $$
declare
  v_run record;
  v_seq int := 0;
  v_id uuid;
begin
  if not public.is_order_manager() then raise exception 'Sem permissão.'; end if;
  select * into v_run from public.delivery_runs where id = p_run and company_id = public.my_company_id();
  if v_run.id is null or v_run.status in ('finished', 'cancelled') then
    raise exception 'Saída não encontrada ou já encerrada.';
  end if;
  if p_courier is not null and p_courier <> v_run.courier_id then
    perform public.check_courier(p_courier);
    update public.delivery_runs set courier_id = p_courier where id = p_run;
    v_run.courier_id := p_courier;
  end if;

  -- Tira da saída o que não está mais na lista (e não foi entregue).
  update public.delivery_orders
    set run_id = null, courier_id = null, stop_sequence = null, courier_fee = null,
        status = case when status in ('on_route', 'problem') then 'ready' else status end,
        dispatched_at = null
    where run_id = p_run and status not in ('delivered', 'cancelled')
      and not (id = any(coalesce(p_order_ids, '{}')));

  -- Entregues ficam primeiro, na ordem em que foram entregues.
  for v_id in select id from public.delivery_orders where run_id = p_run and status = 'delivered' order by delivered_at loop
    v_seq := v_seq + 1;
    update public.delivery_orders set stop_sequence = v_seq where id = v_id;
  end loop;

  foreach v_id in array coalesce(p_order_ids, '{}') loop
    if exists (select 1 from public.delivery_orders where id = v_id and status = 'delivered' and run_id = p_run) then
      continue;
    end if;
    if not exists (select 1 from public.delivery_orders where id = v_id and company_id = v_run.company_id
                   and order_type = 'delivery'
                   and status in ('received', 'preparing', 'ready', 'on_route', 'problem')
                   and (run_id is null or run_id = p_run)) then
      raise exception 'Pedido indisponível para esta saída.';
    end if;
    v_seq := v_seq + 1;
    update public.delivery_orders set run_id = p_run, courier_id = v_run.courier_id, stop_sequence = v_seq,
      courier_fee = public.courier_order_fee(v_run.courier_id),
      status = case when v_run.status = 'in_progress' then 'on_route' else status end,
      dispatched_at = case when v_run.status = 'in_progress' then coalesce(dispatched_at, now()) else dispatched_at end
      where id = v_id;
  end loop;

  if v_seq = 0 then
    update public.delivery_runs set status = 'cancelled', finished_at = now() where id = p_run;
  else
    perform public.maybe_finish_run(p_run);
  end if;
end;
$$;
grant execute on function public.update_run(uuid, uuid[], uuid) to authenticated;

create or replace function public.maybe_finish_run(p_run uuid)
returns void language plpgsql security definer as $$
begin
  if exists (select 1 from public.delivery_runs where id = p_run and status = 'in_progress')
     and not exists (select 1 from public.delivery_orders where run_id = p_run and status not in ('delivered', 'cancelled')) then
    update public.delivery_runs set status = 'finished', finished_at = now() where id = p_run;
  end if;
end;
$$;
revoke execute on function public.maybe_finish_run(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Ações do motoboy
-- ---------------------------------------------------------------------
create or replace function public.start_run(p_run uuid)
returns void language plpgsql security definer as $$
begin
  update public.delivery_runs set status = 'in_progress', started_at = now()
    where id = p_run and courier_id = auth.uid() and status = 'planned';
  if not found then raise exception 'Saída não encontrada ou já iniciada.'; end if;
  update public.delivery_orders set status = 'on_route', dispatched_at = now()
    where run_id = p_run and status in ('received', 'preparing', 'ready');
end;
$$;
grant execute on function public.start_run(uuid) to authenticated;

-- Escolha entre as 3 rotas (0 = principal). Bloqueada no modo rota exata.
create or replace function public.choose_route(p_order_id uuid, p_choice smallint)
returns void language plpgsql security definer as $$
declare v_strict boolean;
begin
  select r.strict_route into v_strict from public.delivery_orders o join public.delivery_runs r on r.id = o.run_id
    where o.id = p_order_id and o.courier_id = auth.uid();
  if v_strict is null then raise exception 'Pedido não encontrado.'; end if;
  if v_strict and p_choice <> 0 then raise exception 'Esta empresa exige seguir a rota definida.'; end if;
  update public.delivery_orders set route_choice = p_choice where id = p_order_id;
end;
$$;
grant execute on function public.choose_route(uuid, smallint) to authenticated;

create or replace function public.complete_delivery(p_order_id uuid, p_code text default null,
                                                    p_lat double precision default null, p_lng double precision default null)
returns text language plpgsql security definer as $$
declare
  v_order record;
  v_needs_code boolean;
  v_code record;
begin
  select o.*, c.feature_delivery_code into v_order
    from public.delivery_orders o join public.companies c on c.id = o.company_id
    where o.id = p_order_id and o.courier_id = auth.uid();
  if v_order.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_order.status <> 'on_route' then raise exception 'Este pedido não está em rota.'; end if;

  v_needs_code := v_order.feature_delivery_code;
  if v_needs_code then
    select * into v_code from public.order_delivery_codes where order_id = p_order_id for update;
    if v_code.locked then
      return 'locked';
    end if;
    if v_code.order_id is null or p_code is null or btrim(p_code) is distinct from v_code.code then
      update public.order_delivery_codes
        set failed_attempts = failed_attempts + 1, locked = failed_attempts + 1 >= 5
        where order_id = p_order_id;
      if v_code.failed_attempts + 1 >= 5 then
        perform public.notify_company_managers(v_order.company_id, 'delivery_code_locked',
          'Código de entrega bloqueado',
          'Pedido #' || v_order.number || ': 5 tentativas erradas. Libere ou finalize manualmente.');
        return 'locked';
      end if;
      return 'wrong_code';
    end if;
  end if;

  update public.delivery_orders set status = 'delivered', delivered_at = now(),
    delivered_lat = p_lat, delivered_lng = p_lng, delivered_by_code = v_needs_code
    where id = p_order_id;
  perform public.maybe_finish_run(v_order.run_id);
  return 'ok';
end;
$$;
grant execute on function public.complete_delivery(uuid, text, double precision, double precision) to authenticated;

create or replace function public.report_problem(p_order_id uuid, p_reason text)
returns void language plpgsql security definer as $$
declare v_order record;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Informe o motivo.'; end if;
  update public.delivery_orders set status = 'problem', problem_reason = p_reason
    where id = p_order_id and courier_id = auth.uid() and status = 'on_route'
    returning * into v_order;
  if v_order.id is null then raise exception 'Pedido não encontrado ou não está em rota.'; end if;
  perform public.notify_company_managers(v_order.company_id, 'delivery_problem',
    'Problema na entrega', 'Pedido #' || v_order.number || ': ' || p_reason);
end;
$$;
grant execute on function public.report_problem(uuid, text) to authenticated;

-- Exceção: cliente sem código. Só gestor, com motivo, fica na auditoria.
create or replace function public.force_complete_delivery(p_order_id uuid, p_reason text)
returns void language plpgsql security definer as $$
declare v_order record;
begin
  if not public.is_order_manager() then raise exception 'Sem permissão.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'O motivo é obrigatório.'; end if;
  update public.delivery_orders set status = 'delivered', delivered_at = now(), delivered_by_code = false,
    forced_reason = p_reason
    where id = p_order_id and company_id = public.my_company_id() and status in ('on_route', 'problem')
    returning * into v_order;
  if v_order.id is null then raise exception 'Pedido não encontrado ou não está em rota.'; end if;
  perform public.log_audit(v_order.company_id, 'delivery_forced',
    jsonb_build_object('order_id', p_order_id, 'number', v_order.number, 'reason', p_reason, 'by', auth.uid()));
  perform public.maybe_finish_run(v_order.run_id);
end;
$$;
grant execute on function public.force_complete_delivery(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Histórico de posições do motoboy
-- ---------------------------------------------------------------------
create table if not exists public.location_pings (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  courier_id uuid not null references public.profiles(id) on delete cascade,
  run_id uuid references public.delivery_runs(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  accuracy real,
  speed real,
  off_route boolean not null default false,
  recorded_at timestamptz not null default now()
);
create index if not exists location_pings_courier_idx on public.location_pings(courier_id, recorded_at desc);
create index if not exists location_pings_run_idx on public.location_pings(run_id, recorded_at);
alter table public.location_pings enable row level security;

drop policy if exists location_pings_insert_own on public.location_pings;
create policy location_pings_insert_own on public.location_pings
  for insert with check (
    courier_id = auth.uid() and company_id = public.my_company_id()
    and (run_id is null or exists (select 1 from public.delivery_runs r where r.id = run_id and r.courier_id = auth.uid()))
  );
drop policy if exists location_pings_read on public.location_pings;
create policy location_pings_read on public.location_pings
  for select using (
    courier_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or courier_id in (select public.my_supervised_ids())
    or public.is_platform_admin()
  );

-- Apaga histórico antigo. Agende no Supabase (Database → Cron):
--   select public.purge_location_pings(90);  -- diariamente
create or replace function public.purge_location_pings(p_days integer default 90)
returns integer language sql security definer as $$
  with d as (delete from public.location_pings where recorded_at < now() - make_interval(days => p_days) returning 1)
  select count(*)::int from d
$$;
revoke execute on function public.purge_location_pings(integer) from public, anon, authenticated;

-- Tempo real para a fila, saídas e mapa ao vivo.
do $$
declare t text;
begin
  foreach t in array array['delivery_orders', 'delivery_runs', 'location_pings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Desvio de rota numa saída de entrega: avisa os gestores, no máximo uma
-- vez a cada 5 minutos por saída (o app chama a cada episódio de desvio).
alter table public.delivery_runs add column if not exists last_off_route_at timestamptz;

create or replace function public.notify_run_off_route(p_run uuid, p_meters integer default null)
returns void language plpgsql security definer as $$
declare v_run record;
begin
  select r.*, p.name as courier_name into v_run
    from public.delivery_runs r join public.profiles p on p.id = r.courier_id
    where r.id = p_run and r.courier_id = auth.uid() and r.status = 'in_progress';
  if v_run.id is null then raise exception 'Saída não encontrada.'; end if;
  if v_run.last_off_route_at is not null and v_run.last_off_route_at > now() - interval '5 minutes' then
    return;
  end if;
  update public.delivery_runs set last_off_route_at = now() where id = p_run;
  perform public.notify_company_managers(v_run.company_id, 'off_route',
    case when v_run.strict_route then 'Desvio de rota (rota exata)' else 'Desvio de rota' end,
    v_run.courier_name || ' saiu do trajeto' || coalesce(' (' || p_meters || ' m)', '') || '.');
end;
$$;
grant execute on function public.notify_run_off_route(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Leitura da própria empresa: só o admin lê a linha inteira (que tem a
-- chave de licença e o código de convite). Antes, qualquer colaborador
-- lia a chave de licença e podia resgatá-la para virar admin da empresa.
-- Os demais leem só os ajustes de que precisam, por esta função.
-- ---------------------------------------------------------------------
drop policy if exists companies_self_read on public.companies;
create policy companies_self_read on public.companies
  for select using (id = public.my_company_id() and public.my_company_role() = 'company_admin');

drop function if exists public.my_company_settings();
create or replace function public.my_company_settings()
returns table(id uuid, name text, status text, feature_delivery_code boolean, feature_branding boolean,
              strict_route_mode boolean, off_route_meters integer)
language sql stable security definer as $$
  select c.id, c.name, c.status, c.feature_delivery_code, c.feature_branding, c.strict_route_mode, c.off_route_meters
  from public.companies c where c.id = public.my_company_id()
$$;
grant execute on function public.my_company_settings() to authenticated;

-- =====================================================================
-- MARCA PRÓPRIA (liberada pela plataforma em feature_branding)
-- Imagens ficam no bucket público "company-branding", na pasta
-- <company_id>/. Só o admin da empresa, com o recurso liberado, envia.
-- =====================================================================
alter table public.companies add column if not exists brand_color text
  check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.companies add column if not exists brand_logo_url text;
alter table public.companies add column if not exists brand_icon_url text;
alter table public.companies add column if not exists brand_login_bg_url text;
alter table public.companies add column if not exists brand_share_url text;

create or replace function public.guard_company_branding()
returns trigger language plpgsql as $$
begin
  if not public.is_client_call() or public.is_platform_admin() then
    return new;
  end if;
  if not old.feature_branding and (
       new.brand_color is distinct from old.brand_color
    or new.brand_logo_url is distinct from old.brand_logo_url
    or new.brand_icon_url is distinct from old.brand_icon_url
    or new.brand_login_bg_url is distinct from old.brand_login_bg_url
    or new.brand_share_url is distinct from old.brand_share_url) then
    raise exception 'A marca própria não está liberada para esta empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_company_branding on public.companies;
create trigger trg_guard_company_branding before update on public.companies
  for each row execute function public.guard_company_branding();

drop function if exists public.my_company_settings();
create or replace function public.my_company_settings()
returns table(id uuid, name text, status text, feature_delivery_code boolean, feature_branding boolean,
              strict_route_mode boolean, off_route_meters integer,
              brand_color text, brand_logo_url text, brand_icon_url text, brand_login_bg_url text, brand_share_url text)
language sql stable security definer as $$
  select c.id, c.name, c.status, c.feature_delivery_code, c.feature_branding, c.strict_route_mode, c.off_route_meters,
         case when c.feature_branding then c.brand_color end,
         case when c.feature_branding then c.brand_logo_url end,
         case when c.feature_branding then c.brand_icon_url end,
         case when c.feature_branding then c.brand_login_bg_url end,
         case when c.feature_branding then c.brand_share_url end
  from public.companies c where c.id = public.my_company_id()
$$;
grant execute on function public.my_company_settings() to authenticated;

-- Marca na página pública de avaliação (cliente final, sem login).
create or replace function public.get_rating_branding(p_token uuid)
returns table(company_name text, brand_color text, brand_logo_url text, brand_share_url text)
language sql stable security definer as $$
  select c.name,
         case when c.feature_branding then c.brand_color end,
         case when c.feature_branding then c.brand_logo_url end,
         case when c.feature_branding then c.brand_share_url end
  from public.assignments a join public.companies c on c.id = a.company_id
  where a.rating_token = p_token
$$;
grant execute on function public.get_rating_branding(uuid) to anon, authenticated;

insert into storage.buckets (id, name, public) values ('company-branding', 'company-branding', true)
  on conflict (id) do nothing;

drop policy if exists company_branding_write on storage.objects;
create policy company_branding_write on storage.objects
  for all using (
    bucket_id = 'company-branding'
    and (storage.foldername(name))[1] = public.my_company_id()::text
    and public.my_company_role() = 'company_admin'
    and exists (select 1 from public.companies c where c.id = public.my_company_id() and c.feature_branding)
  )
  with check (
    bucket_id = 'company-branding'
    and (storage.foldername(name))[1] = public.my_company_id()::text
    and public.my_company_role() = 'company_admin'
    and exists (select 1 from public.companies c where c.id = public.my_company_id() and c.feature_branding)
  );

-- =====================================================================
-- FASES 3 E 4 — FINANCEIRO E RELATÓRIOS
-- Turnos e acerto do motoboy, conferência de pagamento, caixa do dia,
-- faturas da licença e relatórios (financeiro, produtividade, licenças).
-- Valores calculados sempre no banco, por funções; o navegador só lê.
-- =====================================================================

-- Fuso usado para "dia" nos relatórios e no caixa.
alter table public.companies add column if not exists timezone text not null default 'America/Sao_Paulo';
-- Remuneração padrão do motoboy (o admin da empresa ajusta).
alter table public.companies add column if not exists courier_daily_rate numeric(10,2) not null default 0;
alter table public.companies add column if not exists courier_per_delivery numeric(10,2) not null default 0;
alter table public.companies add column if not exists courier_per_km numeric(10,2) not null default 0;
-- Cobrança da licença (só a plataforma altera).
alter table public.companies add column if not exists monthly_price numeric(10,2) not null default 0;
alter table public.companies add column if not exists billing_day integer not null default 10
  check (billing_day between 1 and 28);
alter table public.companies add column if not exists grace_days integer not null default 5
  check (grace_days between 0 and 60);

create or replace function public.guard_company_billing()
returns trigger language plpgsql as $$
begin
  if not public.is_client_call() or public.is_platform_admin() then
    return new;
  end if;
  if new.monthly_price is distinct from old.monthly_price
     or new.billing_day is distinct from old.billing_day
     or new.grace_days is distinct from old.grace_days then
    raise exception 'Somente a plataforma altera a cobrança da licença.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_company_billing on public.companies;
create trigger trg_guard_company_billing before update on public.companies
  for each row execute function public.guard_company_billing();

-- Distância em metros entre dois pontos (fórmula de haversine).
create or replace function public.geo_distance_m(lat1 double precision, lng1 double precision,
                                                 lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Km rodado por um motoboy num intervalo, a partir das posições gravadas.
-- Saltos acima de 2 km entre duas posições seguidas são erro de GPS ou
-- app fechado no caminho, e não entram na soma.
create or replace function public.courier_km(p_courier uuid, p_from timestamptz, p_to timestamptz)
returns numeric language sql stable security definer as $$
  select coalesce(round((sum(d) / 1000)::numeric, 2), 0)
  from (
    select public.geo_distance_m(lag(lat) over w, lag(lng) over w, lat, lng) as d
    from public.location_pings
    where courier_id = p_courier and recorded_at >= p_from and recorded_at < p_to
    window w as (order by recorded_at)
  ) x
  where d is not null and d < 2000
$$;
revoke execute on function public.courier_km(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Intervalo [início, fim) de um período em dias inteiros, no fuso da empresa.
create or replace function public.company_period(p_company uuid, p_from date, p_to date,
                                                 out o_from timestamptz, out o_to timestamptz)
language sql stable security definer as $$
  select (p_from::timestamp at time zone c.timezone), ((p_to + 1)::timestamp at time zone c.timezone)
  from public.companies c where c.id = p_company
$$;
revoke execute on function public.company_period(uuid, date, date) from public, anon, authenticated;

-- Contagem de desvios por saída (para o relatório de produtividade).
alter table public.delivery_runs add column if not exists off_route_events integer not null default 0;

create or replace function public.notify_run_off_route(p_run uuid, p_meters integer default null)
returns void language plpgsql security definer as $$
declare v_run record;
begin
  select r.*, p.name as courier_name into v_run
    from public.delivery_runs r join public.profiles p on p.id = r.courier_id
    where r.id = p_run and r.courier_id = auth.uid() and r.status = 'in_progress';
  if v_run.id is null then raise exception 'Saída não encontrada.'; end if;
  if v_run.last_off_route_at is not null and v_run.last_off_route_at > now() - interval '5 minutes' then
    return;
  end if;
  update public.delivery_runs set last_off_route_at = now(), off_route_events = off_route_events + 1
    where id = p_run;
  perform public.notify_company_managers(v_run.company_id, 'off_route',
    case when v_run.strict_route then 'Desvio de rota (rota exata)' else 'Desvio de rota' end,
    v_run.courier_name || ' saiu do trajeto' || coalesce(' (' || p_meters || ' m)', '') || '.');
end;
$$;
grant execute on function public.notify_run_off_route(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Valores próprios de um motoboy (vazio = usa o padrão da empresa)
-- ---------------------------------------------------------------------
create table if not exists public.courier_rates (
  courier_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  daily_rate numeric(10,2) check (daily_rate >= 0),
  per_delivery numeric(10,2) check (per_delivery >= 0),
  per_km numeric(10,2) check (per_km >= 0),
  updated_at timestamptz not null default now()
);
alter table public.courier_rates enable row level security;
drop policy if exists courier_rates_admin on public.courier_rates;
create policy courier_rates_admin on public.courier_rates
  for all using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
  with check (
    company_id = public.my_company_id() and public.my_company_role() = 'company_admin'
    and exists (select 1 from public.profiles p where p.id = courier_id and p.company_id = public.my_company_id())
  );
drop policy if exists courier_rates_own on public.courier_rates;
create policy courier_rates_own on public.courier_rates for select using (courier_id = auth.uid());

-- ---------------------------------------------------------------------
-- Turnos do motoboy
-- ---------------------------------------------------------------------
create table if not exists public.courier_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  courier_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  km numeric(10,2),
  closed_by uuid references public.profiles(id)
);
create index if not exists courier_shifts_courier_idx on public.courier_shifts(courier_id, started_at desc);
create unique index if not exists courier_shifts_one_open on public.courier_shifts(courier_id) where ended_at is null;
alter table public.courier_shifts enable row level security;
drop policy if exists courier_shifts_read on public.courier_shifts;
create policy courier_shifts_read on public.courier_shifts
  for select using (
    courier_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or courier_id in (select public.my_supervised_ids())
    or public.is_platform_admin()
  );

create or replace function public.start_shift()
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if public.my_company_role() is distinct from 'collaborator' then raise exception 'Só o motoboy inicia turno.'; end if;
  if exists (select 1 from public.courier_shifts where courier_id = auth.uid() and ended_at is null) then
    raise exception 'Já existe um turno aberto.';
  end if;
  insert into public.courier_shifts (company_id, courier_id) values (public.my_company_id(), auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.start_shift() to authenticated;

-- Encerra um turno: o próprio motoboy, ou o admin da empresa (turno esquecido aberto).
create or replace function public.end_shift(p_shift uuid default null)
returns void language plpgsql security definer as $$
declare v record;
begin
  select * into v from public.courier_shifts s
    where s.ended_at is null
      and (case when p_shift is null then s.courier_id = auth.uid() else s.id = p_shift end);
  if v.id is null then raise exception 'Nenhum turno aberto.'; end if;
  if v.courier_id <> auth.uid() and not (v.company_id = public.my_company_id() and public.my_company_role() = 'company_admin') then
    raise exception 'Sem permissão para encerrar este turno.';
  end if;
  update public.courier_shifts set ended_at = now(), closed_by = auth.uid(),
         km = public.courier_km(v.courier_id, v.started_at, now())
    where id = v.id;
end;
$$;
grant execute on function public.end_shift(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Conferência de pagamento (dinheiro/troco que o motoboy traz de volta)
-- ---------------------------------------------------------------------
alter table public.delivery_orders add column if not exists payment_received boolean not null default false;
alter table public.delivery_orders add column if not exists payment_received_at timestamptz;
alter table public.delivery_orders add column if not exists payment_received_by uuid references public.profiles(id);

create or replace function public.guard_order_payment()
returns trigger language plpgsql as $$
begin
  if public.is_client_call() and (
       new.payment_received is distinct from old.payment_received
    or new.payment_received_at is distinct from old.payment_received_at
    or new.payment_received_by is distinct from old.payment_received_by) then
    raise exception 'Use a conferência de pagamento para marcar recebimento.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_order_payment on public.delivery_orders;
create trigger trg_guard_order_payment before update on public.delivery_orders
  for each row execute function public.guard_order_payment();

create or replace function public.confirm_payments(p_order_ids uuid[], p_received boolean default true)
returns integer language plpgsql security definer as $$
declare n integer;
begin
  if not public.is_order_manager() then raise exception 'Sem permissão.'; end if;
  update public.delivery_orders
    set payment_received = p_received,
        payment_received_at = case when p_received then now() end,
        payment_received_by = case when p_received then auth.uid() end
    where id = any(p_order_ids) and company_id = public.my_company_id() and status = 'delivered';
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function public.confirm_payments(uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Caixa do dia: abertura, sangrias, reforços e despesas
-- ---------------------------------------------------------------------
create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('opening', 'deposit', 'withdrawal', 'expense')),
  amount numeric(10,2) not null check (amount > 0),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_company_idx on public.cash_movements(company_id, created_at desc);
alter table public.cash_movements enable row level security;
drop policy if exists cash_movements_admin on public.cash_movements;
create policy cash_movements_admin on public.cash_movements
  for all using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
  with check (company_id = public.my_company_id() and public.my_company_role() = 'company_admin'
              and created_by = auth.uid());

-- ---------------------------------------------------------------------
-- Acerto do motoboy: diária x dias trabalhados + valor por entrega + km
-- ---------------------------------------------------------------------
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  courier_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  days_worked integer not null default 0,
  deliveries integer not null default 0,
  km numeric(10,2) not null default 0,
  daily_rate numeric(10,2) not null default 0,
  per_delivery numeric(10,2) not null default 0,
  per_km numeric(10,2) not null default 0,
  daily_total numeric(10,2) not null default 0,
  delivery_total numeric(10,2) not null default 0,
  km_total numeric(10,2) not null default 0,
  adjustment numeric(10,2) not null default 0,
  adjustment_note text,
  total numeric(10,2) not null default 0,
  cash_collected numeric(10,2) not null default 0,
  status text not null default 'open' check (status in ('open', 'paid')),
  paid_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists settlements_company_idx on public.settlements(company_id, period_end desc);
alter table public.settlements enable row level security;
drop policy if exists settlements_read on public.settlements;
create policy settlements_read on public.settlements
  for select using (
    courier_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  );

-- Cálculo do acerto (sem gravar). Dias trabalhados = dias com turno ou
-- com entrega; km = turnos encerrados + posições fora de turno no período.
create or replace function public.compute_settlement(p_courier uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer as $$
declare
  v_company uuid;
  c record;
  r record;
  v_from timestamptz; v_to timestamptz;
  v_days int; v_deliv int; v_km numeric; v_cash numeric;
  v_daily numeric; v_per numeric; v_perkm numeric;
begin
  select company_id into v_company from public.profiles where id = p_courier;
  select * into c from public.companies where id = v_company;
  select * into r from public.courier_rates where courier_id = p_courier;
  select o_from, o_to into v_from, v_to from public.company_period(v_company, p_from, p_to);

  v_daily := coalesce(r.daily_rate, c.courier_daily_rate);
  v_per := coalesce(r.per_delivery, c.courier_per_delivery);
  v_perkm := coalesce(r.per_km, c.courier_per_km);

  select count(*), coalesce(sum(o.total) filter (where o.payment_method = 'dinheiro'), 0)
    into v_deliv, v_cash
    from public.delivery_orders o
    where o.courier_id = p_courier and o.status = 'delivered'
      and o.delivered_at >= v_from and o.delivered_at < v_to;

  -- Diária: cada dia (no fuso da empresa) com pelo menos uma entrega feita.
  select count(distinct (o.delivered_at at time zone c.timezone)::date) into v_days
    from public.delivery_orders o
    where o.courier_id = p_courier and o.status = 'delivered'
      and o.delivered_at >= v_from and o.delivered_at < v_to;

  v_km := public.courier_km(p_courier, v_from, v_to);

  return jsonb_build_object(
    'courier_id', p_courier, 'company_id', v_company,
    'period_start', p_from, 'period_end', p_to,
    'days_worked', v_days, 'deliveries', v_deliv, 'km', v_km,
    'daily_rate', v_daily, 'per_delivery', v_per, 'per_km', v_perkm,
    'daily_total', round(v_days * v_daily, 2),
    'delivery_total', round(v_deliv * v_per, 2),
    'km_total', round(v_km * v_perkm, 2),
    'total', round(v_days * v_daily + v_deliv * v_per + v_km * v_perkm, 2),
    'cash_collected', v_cash);
end;
$$;
revoke execute on function public.compute_settlement(uuid, date, date) from public, anon, authenticated;

-- Prévia: o admin vê de qualquer motoboy da empresa; o motoboy, só a dele.
create or replace function public.preview_settlement(p_courier uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer as $$
begin
  if p_courier <> auth.uid() and not exists (
    select 1 from public.profiles p where p.id = p_courier and p.company_id = public.my_company_id()
      and public.my_company_role() = 'company_admin') then
    raise exception 'Sem permissão.';
  end if;
  return public.compute_settlement(p_courier, p_from, p_to);
end;
$$;
grant execute on function public.preview_settlement(uuid, date, date) to authenticated;

create or replace function public.create_settlement(p_courier uuid, p_from date, p_to date,
                                                    p_adjustment numeric default 0, p_note text default null)
returns uuid language plpgsql security definer as $$
declare v jsonb; v_id uuid;
begin
  if public.my_company_role() is distinct from 'company_admin' then raise exception 'Sem permissão.'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_courier and p.company_id = public.my_company_id()) then
    raise exception 'Motoboy inválido para esta empresa.';
  end if;
  if p_to < p_from then raise exception 'Período inválido.'; end if;
  if exists (select 1 from public.settlements s where s.courier_id = p_courier
             and s.period_start <= p_to and s.period_end >= p_from) then
    raise exception 'Já existe acerto deste motoboy nesse período.';
  end if;
  v := public.compute_settlement(p_courier, p_from, p_to);
  insert into public.settlements (company_id, courier_id, period_start, period_end, days_worked, deliveries, km,
      daily_rate, per_delivery, per_km, daily_total, delivery_total, km_total, adjustment, adjustment_note,
      total, cash_collected, created_by)
    values (public.my_company_id(), p_courier, p_from, p_to, (v->>'days_worked')::int, (v->>'deliveries')::int,
      (v->>'km')::numeric, (v->>'daily_rate')::numeric, (v->>'per_delivery')::numeric, (v->>'per_km')::numeric,
      (v->>'daily_total')::numeric, (v->>'delivery_total')::numeric, (v->>'km_total')::numeric,
      coalesce(p_adjustment, 0), nullif(btrim(p_note), ''),
      (v->>'total')::numeric + coalesce(p_adjustment, 0), (v->>'cash_collected')::numeric, auth.uid())
    returning id into v_id;
  perform public.log_audit(public.my_company_id(), 'settlement_created',
    jsonb_build_object('settlement_id', v_id, 'courier_id', p_courier, 'from', p_from, 'to', p_to));
  return v_id;
end;
$$;
grant execute on function public.create_settlement(uuid, date, date, numeric, text) to authenticated;

create or replace function public.pay_settlement(p_id uuid)
returns void language plpgsql security definer as $$
begin
  if public.my_company_role() is distinct from 'company_admin' then raise exception 'Sem permissão.'; end if;
  update public.settlements set status = 'paid', paid_at = now()
    where id = p_id and company_id = public.my_company_id() and status = 'open';
  if not found then raise exception 'Acerto não encontrado ou já pago.'; end if;
  perform public.log_audit(public.my_company_id(), 'settlement_paid', jsonb_build_object('settlement_id', p_id));
end;
$$;
grant execute on function public.pay_settlement(uuid) to authenticated;

create or replace function public.delete_settlement(p_id uuid)
returns void language plpgsql security definer as $$
begin
  if public.my_company_role() is distinct from 'company_admin' then raise exception 'Sem permissão.'; end if;
  delete from public.settlements where id = p_id and company_id = public.my_company_id() and status = 'open';
  if not found then raise exception 'Só dá para excluir acerto em aberto.'; end if;
  perform public.log_audit(public.my_company_id(), 'settlement_deleted', jsonb_build_object('settlement_id', p_id));
end;
$$;
grant execute on function public.delete_settlement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Faturas da licença (a plataforma gera e dá baixa; a empresa vê as suas)
-- ---------------------------------------------------------------------
create table if not exists public.license_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reference_month date not null,
  amount numeric(10,2) not null check (amount >= 0),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, reference_month)
);
alter table public.license_invoices enable row level security;
drop policy if exists license_invoices_platform on public.license_invoices;
create policy license_invoices_platform on public.license_invoices
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists license_invoices_company on public.license_invoices;
create policy license_invoices_company on public.license_invoices
  for select using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin');

-- Gera as faturas do mês para empresas ativas com mensalidade > 0.
create or replace function public.generate_license_invoices(p_month date)
returns integer language plpgsql security definer as $$
declare n integer; v_month date := date_trunc('month', p_month)::date;
begin
  if not public.is_platform_admin() then raise exception 'Sem permissão.'; end if;
  insert into public.license_invoices (company_id, reference_month, amount, due_date)
    select c.id, v_month, c.monthly_price, v_month + (c.billing_day - 1)
    from public.companies c
    where c.status = 'active' and c.monthly_price > 0
    on conflict (company_id, reference_month) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function public.generate_license_invoices(date) to authenticated;

-- Suspende empresas com fatura vencida há mais que a carência. Rode pela
-- tela da plataforma, ou agende (Database → Cron): select public.apply_overdue_suspensions();
create or replace function public.apply_overdue_suspensions()
returns integer language plpgsql security definer as $$
declare n integer;
begin
  -- Sem usuário logado = agendamento (cron) no próprio banco.
  if auth.uid() is not null and not public.is_platform_admin() then raise exception 'Sem permissão.'; end if;
  with s as (
    update public.companies c set status = 'suspended'
    where c.status = 'active' and exists (
      select 1 from public.license_invoices i
      where i.company_id = c.id and i.status = 'pending' and i.due_date + c.grace_days < current_date)
    returning c.id
  ), a as (
    insert into public.audit_log (company_id, actor_id, action, details)
    select id, auth.uid(), 'company_suspended_overdue', '{}'::jsonb from s
    returning 1
  )
  select count(*) into n from a;
  return n;
end;
$$;
revoke execute on function public.apply_overdue_suspensions() from public, anon;
grant execute on function public.apply_overdue_suspensions() to authenticated;

-- ---------------------------------------------------------------------
-- Relatórios (admin da empresa; a plataforma pode pedir de qualquer empresa)
-- ---------------------------------------------------------------------
create or replace function public.report_company(p_company uuid)
returns uuid language plpgsql stable security definer as $$
begin
  if public.is_platform_admin() and p_company is not null then return p_company; end if;
  if public.my_company_role() is distinct from 'company_admin' then raise exception 'Sem permissão.'; end if;
  return public.my_company_id();
end;
$$;
revoke execute on function public.report_company(uuid) from public, anon, authenticated;

create or replace function public.report_financial(p_from date, p_to date, p_company uuid default null)
returns jsonb language plpgsql stable security definer as $$
declare v_company uuid := public.report_company(p_company); v_from timestamptz; v_to timestamptz; v_tz text;
begin
  select o_from, o_to into v_from, v_to from public.company_period(v_company, p_from, p_to);
  select timezone into v_tz from public.companies where id = v_company;
  return (
    with o as (
      select * from public.delivery_orders
      where company_id = v_company and created_at >= v_from and created_at < v_to
    ), d as (select * from o where status = 'delivered')
    select jsonb_build_object(
      'totals', (select jsonb_build_object(
          'orders', (select count(*) from o),
          'delivered', count(*),
          'cancelled', (select count(*) from o where status = 'cancelled'),
          'problems', (select count(*) from o where status = 'problem'),
          'revenue', coalesce(sum(total), 0),
          'subtotal', coalesce(sum(subtotal), 0),
          'fees', coalesce(sum(coalesce(delivery_fee, 0) + coalesce(courier_fee, 0)), 0),
          'avg_ticket', coalesce(round(avg(total), 2), 0),
          'unconfirmed_cash', coalesce(sum(total) filter (where payment_method = 'dinheiro' and not payment_received), 0))
        from d),
      'by_payment', coalesce((select jsonb_agg(x order by x.total desc) from (
          select coalesce(payment_method, 'nao_informado') as key, count(*) as count, sum(total) as total
          from d group by 1) x), '[]'::jsonb),
      'by_neighborhood', coalesce((select jsonb_agg(x order by x.total desc) from (
          select case when order_type = 'local' then 'Pedido local'
                      else coalesce(nullif(btrim(address_neighborhood), ''), 'Sem bairro') end as key, count(*) as count,
                 sum(total) as total, sum(coalesce(delivery_fee, 0) + coalesce(courier_fee, 0)) as fees
          from d group by 1) x), '[]'::jsonb),
      'by_source', coalesce((select jsonb_agg(x order by x.count desc) from (
          select source as key, count(*) as count, sum(total) as total from d group by 1) x), '[]'::jsonb),
      'by_day', coalesce((select jsonb_agg(x order by x.day) from (
          select (delivered_at at time zone v_tz)::date as day, count(*) as count, sum(total) as total
          from d group by 1) x), '[]'::jsonb),
      'settlements', (select jsonb_build_object(
          'count', count(*), 'total', coalesce(sum(total), 0),
          'paid', coalesce(sum(total) filter (where status = 'paid'), 0),
          'open', coalesce(sum(total) filter (where status = 'open'), 0))
        from public.settlements s
        where s.company_id = v_company and s.period_start <= p_to and s.period_end >= p_from)
    )
  );
end;
$$;
grant execute on function public.report_financial(date, date, uuid) to authenticated;

create or replace function public.report_productivity(p_from date, p_to date, p_company uuid default null)
returns jsonb language plpgsql stable security definer as $$
declare v_company uuid := public.report_company(p_company); v_from timestamptz; v_to timestamptz;
begin
  select o_from, o_to into v_from, v_to from public.company_period(v_company, p_from, p_to);
  return (
    with o as (
      select o.*, z.eta_minutes from public.delivery_orders o
      left join public.delivery_zones z on z.id = o.zone_id
      where o.company_id = v_company and o.created_at >= v_from and o.created_at < v_to
    )
    select jsonb_build_object(
      'times', (select jsonb_build_object(
          'prep_min', round(avg(extract(epoch from ready_at - created_at) / 60)::numeric, 1),
          'wait_min', round(avg(extract(epoch from dispatched_at - coalesce(ready_at, created_at)) / 60)::numeric, 1),
          'route_min', round(avg(extract(epoch from delivered_at - dispatched_at) / 60)::numeric, 1),
          'total_min', round(avg(extract(epoch from delivered_at - created_at) / 60)::numeric, 1),
          'late', count(*) filter (where eta_minutes is not null and delivered_at > created_at + make_interval(mins => eta_minutes)),
          'with_eta', count(*) filter (where eta_minutes is not null))
        from o where status = 'delivered' and order_type = 'delivery'),
      'couriers', coalesce((select jsonb_agg(x order by x.deliveries desc, x.name) from (
          select p.id, p.name,
            (select count(*) from o where o.courier_id = p.id and o.status = 'delivered') as deliveries,
            (select count(*) from o where o.courier_id = p.id and o.status = 'delivered' and o.delivered_by_code) as by_code,
            (select count(*) from o where o.courier_id = p.id and o.status = 'delivered' and o.forced_reason is not null) as forced,
            (select count(*) from o where o.courier_id = p.id and (o.status = 'problem' or o.problem_reason is not null)) as problems,
            (select count(*) from o where o.courier_id = p.id and o.status = 'delivered' and o.eta_minutes is not null
               and o.delivered_at > o.created_at + make_interval(mins => o.eta_minutes)) as late,
            (select round(avg(extract(epoch from o.delivered_at - o.dispatched_at) / 60)::numeric, 1)
               from o where o.courier_id = p.id and o.status = 'delivered') as route_min,
            (select count(*) from public.delivery_runs r where r.courier_id = p.id
               and r.started_at >= v_from and r.started_at < v_to) as runs,
            (select coalesce(sum(r.off_route_events), 0) from public.delivery_runs r where r.courier_id = p.id
               and r.started_at >= v_from and r.started_at < v_to) as off_route,
            public.courier_km(p.id, v_from, v_to) as km,
            (select round(avg(a.customer_rating)::numeric, 2) from public.assignments a
               where a.collaborator_id = p.id and a.rated_at >= v_from and a.rated_at < v_to) as rating_avg,
            (select count(a.customer_rating) from public.assignments a
               where a.collaborator_id = p.id and a.rated_at >= v_from and a.rated_at < v_to) as rating_count
          from public.profiles p
          where p.company_id = v_company and p.company_role = 'collaborator') x), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function public.report_productivity(date, date, uuid) to authenticated;

-- Caixa de um dia: vendas entregues por forma de pagamento + movimentos.
create or replace function public.report_cash_day(p_day date)
returns jsonb language plpgsql stable security definer as $$
declare v_company uuid := public.report_company(null); v_from timestamptz; v_to timestamptz;
begin
  select o_from, o_to into v_from, v_to from public.company_period(v_company, p_day, p_day);
  return (
    with d as (
      select * from public.delivery_orders
      where company_id = v_company and status = 'delivered' and delivered_at >= v_from and delivered_at < v_to
    ), m as (
      select * from public.cash_movements where company_id = v_company and created_at >= v_from and created_at < v_to
    )
    select jsonb_build_object(
      'by_payment', coalesce((select jsonb_agg(x order by x.total desc) from (
          select coalesce(payment_method, 'nao_informado') as key, count(*) as count, sum(total) as total
          from d group by 1) x), '[]'::jsonb),
      'revenue', (select coalesce(sum(total), 0) from d),
      'cash_sales', (select coalesce(sum(total), 0) from d where payment_method = 'dinheiro'),
      'cash_received', (select coalesce(sum(total), 0) from d where payment_method = 'dinheiro' and payment_received),
      'opening', (select coalesce(sum(amount), 0) from m where kind = 'opening'),
      'deposits', (select coalesce(sum(amount), 0) from m where kind = 'deposit'),
      'withdrawals', (select coalesce(sum(amount), 0) from m where kind = 'withdrawal'),
      'expenses', (select coalesce(sum(amount), 0) from m where kind = 'expense'),
      'movements', coalesce((select jsonb_agg(m order by m.created_at) from m), '[]'::jsonb),
      'cash_orders', coalesce((select jsonb_agg(jsonb_build_object(
          'id', d.id, 'number', d.number, 'customer_name', d.customer_name, 'total', d.total,
          'change_for', d.change_for, 'courier', p.name, 'delivered_at', d.delivered_at,
          'payment_received', d.payment_received) order by d.delivered_at)
        from d left join public.profiles p on p.id = d.courier_id where d.payment_method = 'dinheiro'), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function public.report_cash_day(date) to authenticated;

-- Uso de licença (painel da plataforma).
create or replace function public.report_license_usage()
returns jsonb language plpgsql stable security definer as $$
begin
  if not public.is_platform_admin() then raise exception 'Sem permissão.'; end if;
  return coalesce((select jsonb_agg(x order by x.name) from (
    select c.id, c.name, c.status, c.seats_limit, c.monthly_price, c.created_at,
      (select count(*) from public.profiles p where p.company_id = c.id and p.company_role = 'collaborator') as seats_used,
      (select count(distinct o.courier_id) from public.delivery_orders o
         where o.company_id = c.id and o.delivered_at > now() - interval '30 days') as active_couriers_30d,
      (select count(*) from public.delivery_orders o
         where o.company_id = c.id and o.created_at > now() - interval '30 days') as orders_30d,
      (select count(*) from public.assignments a
         where a.company_id = c.id and a.created_at > now() - interval '30 days') as assignments_30d,
      (select max(o.created_at) from public.delivery_orders o where o.company_id = c.id) as last_order_at,
      (select count(*) from public.license_invoices i where i.company_id = c.id and i.status = 'pending'
         and i.due_date < current_date) as overdue_invoices,
      (select coalesce(sum(i.amount), 0) from public.license_invoices i where i.company_id = c.id and i.status = 'pending'
         and i.due_date < current_date) as overdue_amount
    from public.companies c) x), '[]'::jsonb);
end;
$$;
grant execute on function public.report_license_usage() to authenticated;

-- =====================================================================
-- ENDEREÇO DA LOJA — ponto de partida das rotas e referência para achar
-- os endereços digitados nos pedidos (o admin da empresa cadastra).
-- =====================================================================
alter table public.companies add column if not exists store_street text;
alter table public.companies add column if not exists store_number text;
alter table public.companies add column if not exists store_neighborhood text;
alter table public.companies add column if not exists store_city text;
alter table public.companies add column if not exists store_state text;
alter table public.companies add column if not exists store_lat double precision;
alter table public.companies add column if not exists store_lng double precision;

drop function if exists public.my_company_settings();
create or replace function public.my_company_settings()
returns table(id uuid, name text, status text, feature_delivery_code boolean, feature_branding boolean,
              strict_route_mode boolean, off_route_meters integer,
              brand_color text, brand_logo_url text, brand_icon_url text, brand_login_bg_url text, brand_share_url text,
              store_street text, store_number text, store_neighborhood text, store_city text, store_state text,
              store_lat double precision, store_lng double precision)
language sql stable security definer as $$
  select c.id, c.name, c.status, c.feature_delivery_code, c.feature_branding, c.strict_route_mode, c.off_route_meters,
         case when c.feature_branding then c.brand_color end,
         case when c.feature_branding then c.brand_logo_url end,
         case when c.feature_branding then c.brand_icon_url end,
         case when c.feature_branding then c.brand_login_bg_url end,
         case when c.feature_branding then c.brand_share_url end,
         c.store_street, c.store_number, c.store_neighborhood, c.store_city, c.store_state, c.store_lat, c.store_lng
  from public.companies c where c.id = public.my_company_id()
$$;
grant execute on function public.my_company_settings() to authenticated;

-- =====================================================================
-- CARDÁPIO — categorias, produtos (com opções de preço) e adicionais.
-- O admin da empresa gerencia; no pedido o valor vem dos produtos
-- escolhidos (calculado aqui no banco, não digitado).
-- =====================================================================
create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists product_categories_company_idx on public.product_categories(company_id, sort_order);
alter table public.product_categories enable row level security;

-- kind = 'item' (lanche, bebida...) ou 'addon' (adicional/opcional).
-- variants = opções de preço do mesmo produto, ex.:
--   [{"name": "Hambúrguer", "price": 26}, {"name": "Frango ou lombo", "price": 29.5}]
-- Sem opções, vale o campo price.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete set null,
  kind text not null default 'item' check (kind in ('item', 'addon')),
  name text not null check (btrim(name) <> ''),
  description text,
  price numeric(10,2) not null default 0 check (price >= 0),
  variants jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_company_idx on public.products(company_id, kind, category_id, sort_order);
alter table public.products enable row level security;

-- Quem monta pedido (admin e supervisor) lê; só o admin altera.
drop policy if exists product_categories_read on public.product_categories;
create policy product_categories_read on public.product_categories
  for select using ((company_id = public.my_company_id() and public.is_order_manager()) or public.is_platform_admin());
drop policy if exists product_categories_write on public.product_categories;
create policy product_categories_write on public.product_categories
  for all using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
  with check (company_id = public.my_company_id() and public.my_company_role() = 'company_admin');

drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select using ((company_id = public.my_company_id() and public.is_order_manager()) or public.is_platform_admin());
drop policy if exists products_write on public.products;
create policy products_write on public.products
  for all using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
  with check (company_id = public.my_company_id() and public.my_company_role() = 'company_admin');

-- Valida opções de preço e a categoria (tem de ser da mesma empresa).
create or replace function public.products_validate()
returns trigger language plpgsql as $$
declare v jsonb; v_names text[] := '{}';
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  if new.variants is null or jsonb_typeof(new.variants) <> 'array' then
    raise exception 'Opções de preço inválidas.';
  end if;
  if new.kind = 'addon' and jsonb_array_length(new.variants) > 0 then
    raise exception 'Adicional não tem opções de preço.';
  end if;
  for v in select * from jsonb_array_elements(new.variants) loop
    if jsonb_typeof(v) <> 'object' or coalesce(btrim(v->>'name'), '') = ''
       or jsonb_typeof(v->'price') <> 'number' or (v->>'price')::numeric < 0 then
      raise exception 'Cada opção precisa de nome e preço (zero ou mais).';
    end if;
    if lower(btrim(v->>'name')) = any(v_names) then
      raise exception 'Opção "%" repetida.', v->>'name';
    end if;
    v_names := v_names || lower(btrim(v->>'name'));
  end loop;
  -- Com opções, price guarda o menor preço (para listar "a partir de").
  if jsonb_array_length(new.variants) > 0 then
    select min((x->>'price')::numeric) into new.price from jsonb_array_elements(new.variants) x;
  end if;
  if new.category_id is not null and not exists (
    select 1 from public.product_categories c where c.id = new.category_id and c.company_id = new.company_id) then
    raise exception 'Categoria inválida.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_products_validate on public.products;
create trigger trg_products_validate before insert or update on public.products
  for each row execute function public.products_validate();

-- ---------------------------------------------------------------------
-- Itens do pedido (preço copiado do cardápio na hora do pedido)
-- ---------------------------------------------------------------------
create table if not exists public.delivery_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.delivery_orders(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  variant text,
  addons jsonb not null default '[]'::jsonb,
  quantity integer not null check (quantity between 1 and 999),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  notes text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists delivery_order_items_order_idx on public.delivery_order_items(order_id);
alter table public.delivery_order_items enable row level security;

-- Só leitura pelo app; gravação pela função set_order_items.
drop policy if exists delivery_order_items_read on public.delivery_order_items;
create policy delivery_order_items_read on public.delivery_order_items
  for select using (
    (company_id = public.my_company_id() and public.is_order_manager())
    or public.is_platform_admin()
    or exists (select 1 from public.delivery_orders o where o.id = order_id and o.courier_id = auth.uid())
  );

-- Grava os itens de um pedido ainda na fila e recalcula o valor.
-- p_items: [{"product_id": "...", "variant": "Hambúrguer", "addon_ids": ["..."], "quantity": 2, "notes": "sem cebola"}]
create or replace function public.set_order_items(p_order_id uuid, p_items jsonb)
returns numeric language plpgsql security definer as $$
declare
  v_order record;
  e jsonb;
  p record;
  a record;
  v_variant text;
  v_price numeric;
  v_addons jsonb;
  v_addon_total numeric;
  v_qty integer;
  v_subtotal numeric;
  v_pos integer := 0;
begin
  select * into v_order from public.delivery_orders where id = p_order_id;
  if v_order.id is null
     or not ((v_order.company_id = public.my_company_id() and public.is_order_manager()) or public.is_platform_admin()) then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_order.status not in ('received', 'preparing', 'ready') or v_order.run_id is not null then
    raise exception 'Só dá para mudar os itens de pedido que ainda não saiu para entrega.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione ao menos um produto ao pedido.';
  end if;

  delete from public.delivery_order_items where order_id = p_order_id;

  for e in select * from jsonb_array_elements(p_items) loop
    select * into p from public.products
      where id = nullif(e->>'product_id', '')::uuid and company_id = v_order.company_id
        and kind = 'item' and active
        and not exists (select 1 from public.product_categories c where c.id = products.category_id and not c.active);
    if p.id is null then raise exception 'Produto não encontrado ou fora do cardápio.'; end if;

    v_variant := nullif(btrim(e->>'variant'), '');
    if jsonb_array_length(p.variants) > 0 then
      select (x->>'price')::numeric, x->>'name' into v_price, v_variant
        from jsonb_array_elements(p.variants) x where x->>'name' = v_variant;
      if v_price is null then raise exception 'Escolha a opção de "%".', p.name; end if;
    else
      v_price := p.price; v_variant := null;
    end if;

    v_addons := '[]'::jsonb; v_addon_total := 0;
    for a in select pr.id, pr.name, pr.price from public.products pr
             where pr.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(e->'addon_ids', '[]'::jsonb)) x)
               and pr.company_id = v_order.company_id and pr.kind = 'addon' and pr.active
             order by pr.sort_order, pr.name loop
      v_addons := v_addons || jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price);
      v_addon_total := v_addon_total + a.price;
    end loop;
    if jsonb_array_length(v_addons) <> jsonb_array_length(coalesce(e->'addon_ids', '[]'::jsonb)) then
      raise exception 'Adicional não encontrado ou inativo no cardápio.';
    end if;

    v_qty := coalesce(nullif(e->>'quantity', '')::integer, 1);
    if v_qty < 1 or v_qty > 999 then raise exception 'Quantidade inválida.'; end if;

    v_pos := v_pos + 1;
    insert into public.delivery_order_items (order_id, company_id, product_id, name, variant, addons, quantity, unit_price, notes, position)
      values (p_order_id, v_order.company_id, p.id, p.name, v_variant, v_addons, v_qty,
              v_price + v_addon_total, nullif(btrim(e->>'notes'), ''), v_pos);
  end loop;

  select coalesce(sum(i.unit_price * i.quantity), 0) into v_subtotal
    from public.delivery_order_items i where i.order_id = p_order_id;

  -- Texto legível em "items" (motoboy, mensagens e relatórios usam).
  update public.delivery_orders set subtotal = v_subtotal,
    items = (select string_agg(
               i.quantity || 'x ' || i.name || coalesce(' (' || i.variant || ')', '')
               || coalesce((select ' + ' || string_agg(x->>'name', ' + ') from jsonb_array_elements(i.addons) x), '')
               || coalesce(' · ' || i.notes, ''), E'\n' order by i.position)
             from public.delivery_order_items i where i.order_id = p_order_id)
    where id = p_order_id;
  return v_subtotal;
end;
$$;
grant execute on function public.set_order_items(uuid, jsonb) to authenticated;

-- Cria o pedido e os itens numa transação só. Roda com as permissões de
-- quem chama (as regras de pedidos valem igual a um insert direto).
create or replace function public.create_delivery_order(p_order jsonb, p_items jsonb)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione ao menos um produto ao pedido.';
  end if;
  insert into public.delivery_orders (
    company_id, source, customer_id, customer_name, customer_phone,
    address_street, address_number, address_complement, address_neighborhood, address_city, lat, lng,
    delivery_fee, payment_method, change_for, notes)
  values (
    public.my_company_id(), coalesce(nullif(p_order->>'source', ''), 'balcao'),
    nullif(p_order->>'customer_id', '')::uuid, btrim(p_order->>'customer_name'), nullif(p_order->>'customer_phone', ''),
    nullif(p_order->>'address_street', ''), nullif(p_order->>'address_number', ''), nullif(p_order->>'address_complement', ''),
    nullif(p_order->>'address_neighborhood', ''), nullif(p_order->>'address_city', ''),
    nullif(p_order->>'lat', '')::double precision, nullif(p_order->>'lng', '')::double precision,
    nullif(p_order->>'delivery_fee', '')::numeric, nullif(p_order->>'payment_method', ''),
    nullif(p_order->>'change_for', '')::numeric, nullif(p_order->>'notes', ''))
  returning id into v_id;
  perform public.set_order_items(v_id, p_items);
  return v_id;
end;
$$;
grant execute on function public.create_delivery_order(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Taxa do motoboy no pedido: ao despachar, o valor por entrega do motoboy
-- (o dele ou o padrão da empresa) entra no total do pedido.
-- ---------------------------------------------------------------------
alter table public.companies add column if not exists courier_fee_on_order boolean not null default true;
alter table public.delivery_orders add column if not exists courier_fee numeric(10,2);

-- O total passa a somar a taxa do motoboy (coluna calculada é recriada uma vez).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'delivery_orders' and column_name = 'total'
      and generation_expression like '%courier_fee%') then
    alter table public.delivery_orders drop column if exists total;
    alter table public.delivery_orders add column total numeric(10,2)
      generated always as (subtotal + coalesce(delivery_fee, 0) + coalesce(courier_fee, 0)) stored;
  end if;
end $$;

create or replace function public.courier_order_fee(p_courier uuid)
returns numeric language sql stable security definer as $$
  select nullif(coalesce(r.per_delivery, c.courier_per_delivery, 0), 0)
  from public.profiles p
  join public.companies c on c.id = p.company_id and c.courier_fee_on_order
  left join public.courier_rates r on r.courier_id = p.id
  where p.id = p_courier
$$;
revoke execute on function public.courier_order_fee(uuid) from public, anon, authenticated;

-- Para a tela de despacho mostrar a taxa de cada motoboy antes de confirmar.
create or replace function public.my_courier_fees()
returns table(courier_id uuid, fee numeric) language sql stable security definer as $$
  select p.id, public.courier_order_fee(p.id)
  from public.profiles p
  where p.company_id = public.my_company_id() and p.company_role = 'collaborator' and public.is_order_manager()
$$;
grant execute on function public.my_courier_fees() to authenticated;

-- =====================================================================
-- DESPACHO AUTOMÁTICO
-- Motoboy em expediente e livre recebe sozinho a próxima saída: começa
-- pelo pedido que espera há mais tempo e junta os que ficam no caminho
-- (até o máximo de entregas da empresa), na ordem de menor trajeto.
-- Roda quando: pedido fica pronto, saída termina, motoboy entra/volta do
-- expediente, pedido é criado; e a cada minuto (pg_cron, se houver) e a
-- cada 30 s pelas telas abertas, como rede de segurança.
-- =====================================================================
alter table public.companies add column if not exists auto_dispatch boolean not null default false;
alter table public.companies add column if not exists auto_max_stops integer not null default 3
  check (auto_max_stops between 1 and 20);
alter table public.companies add column if not exists auto_max_detour_km numeric(5,2) not null default 2
  check (auto_max_detour_km between 0 and 50);
alter table public.companies add column if not exists auto_hold_minutes integer not null default 0
  check (auto_hold_minutes between 0 and 30);
alter table public.companies add column if not exists auto_accept_minutes integer not null default 5
  check (auto_accept_minutes between 0 and 60);
alter table public.companies add column if not exists auto_dispatch_when text not null default 'ready'
  check (auto_dispatch_when in ('ready', 'any'));

-- Despacho automático é o padrão (06/10/2026). Liga uma única vez para as
-- empresas que já existiam; quem desligar depois nos ajustes continua desligado.
alter table public.companies alter column auto_dispatch set default true;
-- Saída vai cheia até o máximo da loja (06/10/2026): desvio 0 = sem limite.
alter table public.companies alter column auto_max_detour_km set default 0;
create table if not exists public.schema_flags (name text primary key, applied_at timestamptz not null default now());
alter table public.schema_flags enable row level security;
do $$ begin
  if not exists (select 1 from public.schema_flags where name = 'auto_dispatch_on') then
    update public.companies set auto_dispatch = true where not auto_dispatch;
    insert into public.schema_flags (name) values ('auto_dispatch_on');
  end if;
  if not exists (select 1 from public.schema_flags where name = 'auto_full_route') then
    update public.companies set auto_max_detour_km = 0;
    insert into public.schema_flags (name) values ('auto_full_route');
  end if;
end $$;

alter table public.courier_shifts add column if not exists paused boolean not null default false;
alter table public.courier_shifts add column if not exists paused_reason text;
alter table public.delivery_runs add column if not exists auto boolean not null default false;

-- Distância em linha reta (km).
create or replace function public.geo_km(lat1 double precision, lng1 double precision,
                                         lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Tira um motoboy das saídas que ele ainda não iniciou (pedidos voltam à fila).
create or replace function public.release_planned_runs(p_courier uuid)
returns integer language plpgsql security definer as $$
declare n integer := 0; r record;
begin
  for r in select id from public.delivery_runs where courier_id = p_courier and status = 'planned' for update loop
    -- Cancela antes de soltar os pedidos: o despacho que roda ao soltar não
    -- pode devolvê-los para esta mesma saída.
    update public.delivery_runs set status = 'cancelled', finished_at = now() where id = r.id;
    update public.delivery_orders
      set run_id = null, courier_id = null, stop_sequence = null, courier_fee = null
      where run_id = r.id and status in ('received', 'preparing', 'ready');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.release_planned_runs(uuid) from public, anon, authenticated;

-- Monta/completa uma rota: parte das paradas já escolhidas (p_seed, em
-- ordem; vazio = começa pelo pedido que espera há mais tempo) e junta os
-- pedidos livres por inserção mais barata no trajeto loja → paradas → loja,
-- até o máximo de entregas da loja. Desvio máximo 0 = sem limite.
-- Devolve a rota inteira na ordem de entrega (ou null se não há pedido).
create or replace function public.auto_plan_route(p_company uuid, p_seed uuid[])
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  c record;
  cid uuid[]; clat double precision[]; clng double precision[];
  used boolean[];
  rid uuid[] := '{}'; rlat double precision[] := '{}'; rlng double precision[] := '{}';
  slat double precision; slng double precision;
  i int; k int; n int; best_i int; best_k int; best_cost double precision; cost double precision;
  plat double precision; plng double precision; nlat double precision; nlng double precision;
  v_oldest uuid;
begin
  select * into c from public.companies where id = p_company;
  slat := c.store_lat; slng := c.store_lng;

  -- Paradas já na rota (saída ainda não confirmada pelo motoboy).
  if coalesce(array_length(p_seed, 1), 0) > 0 then
    select array_agg(o.id order by t.ord), array_agg(o.lat order by t.ord), array_agg(o.lng order by t.ord)
      into rid, rlat, rlng
      from unnest(p_seed) with ordinality t(id, ord) join public.delivery_orders o on o.id = t.id
      where o.lat is not null and o.lng is not null;
    rid := coalesce(rid, '{}'); rlat := coalesce(rlat, '{}'); rlng := coalesce(rlng, '{}');
  end if;

  -- Pedidos livres, do que espera há mais tempo para o mais novo.
  select array_agg(o.id order by o.since, o.number), array_agg(o.lat order by o.since, o.number),
         array_agg(o.lng order by o.since, o.number)
    into cid, clat, clng
    from (select x.id, x.number, x.lat, x.lng,
                 case when c.auto_dispatch_when = 'ready' then coalesce(x.ready_at, x.created_at) else x.created_at end as since
          from public.delivery_orders x
          where x.company_id = p_company and x.run_id is null and x.lat is not null and x.lng is not null
            and x.order_type = 'delivery'
            and x.status in ('received', 'preparing', 'ready')
            and (c.auto_dispatch_when = 'any' or x.status = 'ready')) o;
  if cid is null then
    return case when array_length(rid, 1) > 0 then rid end;
  end if;
  n := array_length(cid, 1);
  used := array_fill(false, array[n]);

  if coalesce(array_length(rid, 1), 0) = 0 then
    rid := array[cid[1]]; rlat := array[clat[1]]; rlng := array[clng[1]];
    used[1] := true;
  end if;
  v_oldest := rid[1];

  -- Inserção mais barata até o máximo da loja.
  while array_length(rid, 1) < c.auto_max_stops loop
    best_cost := null;
    for i in 1 .. n loop
      continue when used[i];
      for k in 0 .. array_length(rid, 1) loop
        if k = 0 then plat := coalesce(slat, rlat[1]); plng := coalesce(slng, rlng[1]);
        else plat := rlat[k]; plng := rlng[k]; end if;
        if k = array_length(rid, 1) then nlat := coalesce(slat, rlat[1]); nlng := coalesce(slng, rlng[1]);
        else nlat := rlat[k + 1]; nlng := rlng[k + 1]; end if;
        cost := public.geo_km(plat, plng, clat[i], clng[i]) + public.geo_km(clat[i], clng[i], nlat, nlng)
                - public.geo_km(plat, plng, nlat, nlng);
        if best_cost is null or cost < best_cost - 1e-9 then best_cost := cost; best_i := i; best_k := k; end if;
      end loop;
    end loop;
    -- 1,3 ≈ ruas em vez de linha reta.
    exit when best_cost is null or (c.auto_max_detour_km > 0 and best_cost * 1.3 > c.auto_max_detour_km);
    rid := rid[1:best_k] || cid[best_i] || rid[best_k + 1:];
    rlat := rlat[1:best_k] || clat[best_i] || rlat[best_k + 1:];
    rlng := rlng[1:best_k] || clng[best_i] || rlng[best_k + 1:];
    used[best_i] := true;
  end loop;

  -- Volta fechada: os dois sentidos têm o mesmo trajeto; usa o que entrega
  -- antes o pedido mais antigo.
  k := array_position(rid, v_oldest);
  i := array_length(rid, 1);
  if k > i + 1 - k or (k = i + 1 - k and slat is not null
      and public.geo_km(slat, slng, rlat[i], rlng[i]) < public.geo_km(slat, slng, rlat[1], rlng[1])) then
    select array_agg(rid[j] order by j desc) into rid from generate_subscripts(rid, 1) j;
  end if;
  return rid;
end;
$$;
revoke execute on function public.auto_plan_route(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.auto_dispatch(p_company uuid)
returns integer language plpgsql security definer as $$
declare
  c record;
  r record;
  v_courier uuid;
  v_oldest timestamptz;
  v_seed uuid[];
  rid uuid[];
  i int;
  v_run uuid;
  v_fee numeric;
  v_count int := 0;
begin
  if coalesce(current_setting('app.auto_dispatch_running', true), '') = '1' then return 0; end if;
  select * into c from public.companies where id = p_company;
  if c.id is null or not c.auto_dispatch or c.status <> 'active' then return 0; end if;
  -- Um despacho por empresa por vez; se outro está rodando, ele cobre este.
  if not pg_try_advisory_xact_lock(hashtext('auto_dispatch:' || p_company::text)) then return 0; end if;
  perform set_config('app.auto_dispatch_running', '1', true);

  -- 1) Saída automática não iniciada no prazo: pedidos voltam e o motoboy
  --    fica em pausa até tocar em "Voltar a receber".
  if c.auto_accept_minutes > 0 then
    for r in select dr.id, dr.courier_id, p.name from public.delivery_runs dr join public.profiles p on p.id = dr.courier_id
             where dr.company_id = p_company and dr.auto and dr.status = 'planned'
               and dr.created_at < now() - make_interval(mins => c.auto_accept_minutes) loop
      perform public.release_planned_runs(r.courier_id);
      update public.courier_shifts set paused = true, paused_reason = 'Não iniciou a saída a tempo'
        where courier_id = r.courier_id and ended_at is null;
      insert into public.notifications (company_id, user_id, type, title, message)
        values (p_company, r.courier_id, 'auto_paused', 'Você foi pausado',
                'A saída não foi iniciada a tempo e foi passada para outro motoboy. Toque em "Voltar a receber" quando puder.');
      perform public.notify_company_managers(p_company, 'auto_timeout', 'Saída não iniciada',
        coalesce(r.name, 'Motoboy') || ' não iniciou a saída a tempo; os pedidos voltaram para a fila automática.');
    end loop;
  end if;

  -- 2) Saída automática ainda não confirmada pelo motoboy e abaixo do máximo:
  --    os pedidos que ficaram prontos depois entram nela (rota refeita).
  for r in select dr.id, dr.courier_id from public.delivery_runs dr
           where dr.company_id = p_company and dr.auto and dr.status = 'planned'
             and (select count(*) from public.delivery_orders o where o.run_id = dr.id) between 1 and c.auto_max_stops - 1
             and exists (select 1 from public.courier_shifts s
                         where s.courier_id = dr.courier_id and s.ended_at is null and not s.paused)
           order by dr.created_at loop
    select array_agg(o.id order by o.stop_sequence) into v_seed
      from public.delivery_orders o where o.run_id = r.id;
    rid := public.auto_plan_route(p_company, v_seed);
    continue when rid is null or array_length(rid, 1) <= coalesce(array_length(v_seed, 1), 0);
    v_fee := public.courier_order_fee(r.courier_id);
    for i in 1 .. array_length(rid, 1) loop
      update public.delivery_orders
        set run_id = r.id, courier_id = r.courier_id, stop_sequence = i,
            courier_fee = case when run_id is null then v_fee else courier_fee end
        where id = rid[i] and (run_id is null or run_id = r.id);
    end loop;
    insert into public.notifications (company_id, user_id, type, title, message)
      values (p_company, r.courier_id, 'new_run', 'Saída atualizada',
              'Agora são ' || array_length(rid, 1) || ' parada(s). Confira a rota antes de sair.');
    v_count := v_count + 1;
  end loop;

  -- 3) Uma saída por motoboy livre, na vez de quem está livre há mais tempo,
  --    com a rota inteira até o máximo da loja.
  loop
    select s.courier_id into v_courier
      from public.courier_shifts s join public.profiles p on p.id = s.courier_id
      where s.company_id = p_company and s.ended_at is null and not s.paused
        and p.company_id = p_company and p.company_role = 'collaborator'
        and not exists (select 1 from public.delivery_runs dr
                        where dr.courier_id = s.courier_id and dr.status in ('planned', 'in_progress'))
      order by greatest(s.started_at, coalesce((select max(dr.finished_at) from public.delivery_runs dr
                                                where dr.courier_id = s.courier_id), '-infinity'::timestamptz)),
               s.started_at
      limit 1;
    exit when v_courier is null;

    -- O mais antigo precisa ter esperado o tempo mínimo (para juntar pedidos).
    select min(case when c.auto_dispatch_when = 'ready' then coalesce(x.ready_at, x.created_at) else x.created_at end)
      into v_oldest
      from public.delivery_orders x
      where x.company_id = p_company and x.run_id is null and x.lat is not null and x.lng is not null
        and x.order_type = 'delivery' and x.status in ('received', 'preparing', 'ready')
        and (c.auto_dispatch_when = 'any' or x.status = 'ready');
    exit when v_oldest is null or v_oldest > now() - make_interval(mins => c.auto_hold_minutes);

    rid := public.auto_plan_route(p_company, '{}');
    exit when rid is null;

    insert into public.delivery_runs (company_id, courier_id, created_by, strict_route, auto)
      values (p_company, v_courier, null, c.strict_route_mode, true) returning id into v_run;
    v_fee := public.courier_order_fee(v_courier);
    for i in 1 .. array_length(rid, 1) loop
      update public.delivery_orders set run_id = v_run, courier_id = v_courier, stop_sequence = i, courier_fee = v_fee
        where id = rid[i] and run_id is null;
    end loop;
    insert into public.notifications (company_id, user_id, type, title, message)
      values (p_company, v_courier, 'new_run', 'Nova saída de entrega',
              array_length(rid, 1) || ' parada(s) aguardando você.');
    v_count := v_count + 1;
    v_courier := null;
  end loop;

  perform set_config('app.auto_dispatch_running', '0', true);
  return v_count;
end;
$$;
revoke execute on function public.auto_dispatch(uuid) from public, anon, authenticated;

-- Telas abertas (gestor e motoboy) chamam a cada 30 s: rede de segurança.
create or replace function public.auto_dispatch_tick()
returns integer language plpgsql security definer as $$
begin
  if public.my_company_id() is null then return 0; end if;
  return public.auto_dispatch(public.my_company_id());
end;
$$;
grant execute on function public.auto_dispatch_tick() to authenticated;

create or replace function public.auto_dispatch_all()
returns integer language plpgsql security definer as $$
declare v uuid; n integer := 0;
begin
  for v in select id from public.companies where auto_dispatch and status = 'active' loop
    begin
      n := n + public.auto_dispatch(v);
    exception when others then
      raise warning 'Despacho automático falhou na empresa %: %', v, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function public.auto_dispatch_all() from public, anon, authenticated;

-- Gatilhos: um erro no despacho nunca impede a ação de quem disparou.
create or replace function public.auto_dispatch_kick()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform public.auto_dispatch(coalesce(new.company_id, old.company_id));
  exception when others then
    raise warning 'Despacho automático falhou: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_auto_dispatch_orders on public.delivery_orders;
create trigger trg_auto_dispatch_orders after update on public.delivery_orders
  for each row when (new.run_id is null and new.status in ('received', 'preparing', 'ready')
                     and new.order_type = 'delivery'
                     and (old.status is distinct from new.status or old.run_id is not null))
  execute function public.auto_dispatch_kick();
drop trigger if exists trg_auto_dispatch_runs on public.delivery_runs;
create trigger trg_auto_dispatch_runs after update on public.delivery_runs
  for each row when (new.status in ('finished', 'cancelled') and old.status is distinct from new.status)
  execute function public.auto_dispatch_kick();
drop trigger if exists trg_auto_dispatch_shifts on public.courier_shifts;
create trigger trg_auto_dispatch_shifts after insert or update on public.courier_shifts
  for each row execute function public.auto_dispatch_kick();
drop trigger if exists trg_auto_dispatch_company on public.companies;
create or replace function public.auto_dispatch_kick_company()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform public.auto_dispatch(new.id);
  exception when others then
    raise warning 'Despacho automático falhou: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger trg_auto_dispatch_company after update on public.companies
  for each row when (new.auto_dispatch and (old.auto_dispatch is distinct from new.auto_dispatch
                     or old.auto_max_stops is distinct from new.auto_max_stops
                     or old.auto_max_detour_km is distinct from new.auto_max_detour_km
                     or old.auto_hold_minutes is distinct from new.auto_hold_minutes
                     or old.auto_dispatch_when is distinct from new.auto_dispatch_when))
  execute function public.auto_dispatch_kick_company();

-- Pedido criado pelo app entra na fila automática na hora.
-- Entrega precisa do nome do cliente; pedido local (balcão) não tem endereço
-- nem taxa de entrega e nunca vai para motoboy.
create or replace function public.create_delivery_order(p_order jsonb, p_items jsonb)
returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_type text := coalesce(nullif(p_order->>'order_type', ''), 'delivery');
  v_local boolean;
  v_name text := nullif(btrim(p_order->>'customer_name'), '');
begin
  if v_type not in ('delivery', 'local') then raise exception 'Tipo de pedido inválido.'; end if;
  v_local := v_type = 'local';
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione ao menos um produto ao pedido.';
  end if;
  if v_name is null then
    if not v_local then raise exception 'Informe o nome do cliente.'; end if;
    v_name := 'Cliente no balcão';
  end if;
  insert into public.delivery_orders (
    company_id, order_type, source, customer_id, customer_name, customer_phone,
    address_street, address_number, address_complement, address_neighborhood, address_city, lat, lng,
    delivery_fee, payment_method, change_for, notes)
  values (
    public.my_company_id(), v_type, coalesce(nullif(p_order->>'source', ''), 'balcao'),
    nullif(p_order->>'customer_id', '')::uuid, v_name, nullif(p_order->>'customer_phone', ''),
    nullif(p_order->>'address_street', ''), nullif(p_order->>'address_number', ''), nullif(p_order->>'address_complement', ''),
    nullif(p_order->>'address_neighborhood', ''), nullif(p_order->>'address_city', ''),
    nullif(p_order->>'lat', '')::double precision, nullif(p_order->>'lng', '')::double precision,
    case when v_local then null else nullif(p_order->>'delivery_fee', '')::numeric end,
    nullif(p_order->>'payment_method', ''),
    nullif(p_order->>'change_for', '')::numeric, nullif(p_order->>'notes', ''))
  returning id into v_id;
  perform public.set_order_items(v_id, p_items);
  if not v_local then
    begin
      perform public.auto_dispatch_tick();
    exception when others then
      raise warning 'Despacho automático falhou: %', sqlerrm;
    end;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Expediente do motoboy (disponível para receber saídas automáticas)
-- ---------------------------------------------------------------------
-- Encerrar: o próprio motoboy ou o admin. Saídas ainda não iniciadas
-- voltam para a fila; a saída em andamento continua até o fim.
create or replace function public.end_shift(p_shift uuid default null)
returns void language plpgsql security definer as $$
declare v record;
begin
  select * into v from public.courier_shifts s
    where s.ended_at is null
      and (case when p_shift is null then s.courier_id = auth.uid() else s.id = p_shift end);
  if v.id is null then raise exception 'Nenhum expediente aberto.'; end if;
  if v.courier_id is distinct from auth.uid() and not (v.company_id = public.my_company_id() and public.is_order_manager()) then
    raise exception 'Sem permissão para encerrar este expediente.';
  end if;
  -- Fecha antes de devolver a saída, senão o despacho daria a ela de novo.
  update public.courier_shifts set ended_at = now(), closed_by = auth.uid(),
         km = public.courier_km(v.courier_id, v.started_at, now())
    where id = v.id;
  perform public.release_planned_runs(v.courier_id);
end;
$$;
grant execute on function public.end_shift(uuid) to authenticated;

-- Pausa / volta a receber: o próprio motoboy ou o gestor.
create or replace function public.set_shift_paused(p_paused boolean, p_courier uuid default null)
returns void language plpgsql security definer as $$
declare v record;
begin
  select * into v from public.courier_shifts s
    where s.ended_at is null and s.courier_id = coalesce(p_courier, auth.uid());
  if v.id is null then raise exception 'Nenhum expediente aberto.'; end if;
  if v.courier_id is distinct from auth.uid() and not (v.company_id = public.my_company_id() and public.is_order_manager()) then
    raise exception 'Sem permissão.';
  end if;
  update public.courier_shifts set paused = p_paused,
    paused_reason = case when p_paused then case when v.courier_id is not distinct from auth.uid() then 'Pausa' else 'Pausado pelo gestor' end end
    where id = v.id;
  if p_paused then perform public.release_planned_runs(v.courier_id); end if;
end;
$$;
grant execute on function public.set_shift_paused(boolean, uuid) to authenticated;

-- Gestores (admin e supervisor) veem quem está em expediente.
drop policy if exists courier_shifts_read on public.courier_shifts;
create policy courier_shifts_read on public.courier_shifts
  for select using (
    courier_id = auth.uid()
    or (company_id = public.my_company_id() and public.is_order_manager())
    or public.is_platform_admin()
  );

-- Rede de segurança no servidor: pg_cron chama o despacho a cada minuto
-- (se a extensão não estiver disponível, as telas abertas cobrem).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      execute 'create extension if not exists pg_cron';
      execute $c$select cron.schedule('auto-dispatch', '* * * * *', 'select public.auto_dispatch_all()')$c$;
    exception when others then
      raise notice 'pg_cron indisponível (%); o despacho automático segue pelos gatilhos e pelas telas abertas.', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Pedido local (balcão): o gestor conclui ao entregar ao cliente na loja.
-- O pagamento foi feito no caixa, então já fica conferido.
-- ---------------------------------------------------------------------
create or replace function public.complete_local_order(p_order_id uuid)
returns void language plpgsql security definer as $$
declare v_order record;
begin
  if not public.is_order_manager() then raise exception 'Sem permissão.'; end if;
  update public.delivery_orders
    set status = 'delivered', delivered_at = now(), ready_at = coalesce(ready_at, now()),
        payment_received = true, payment_received_at = now(), payment_received_by = auth.uid()
    where id = p_order_id and company_id = public.my_company_id() and order_type = 'local'
      and status in ('received', 'preparing', 'ready')
    returning * into v_order;
  if v_order.id is null then raise exception 'Pedido local não encontrado ou já encerrado.'; end if;
end;
$$;
grant execute on function public.complete_local_order(uuid) to authenticated;

-- =====================================================================
-- SEGURANÇA — REVISÃO 2 (06/10/2026)
-- Testada em supabase/tests/29_seguranca_revisao2.sql.
-- Regra usada em todas as checagens abaixo: comparar com "is distinct from"
-- e exigir login. Com "<>", uma chamada sem login (auth.uid() nulo) dava
-- NULL e passava direto pela checagem.
-- =====================================================================

-- Empresa suspensa perde o acesso aos dados (o painel mostra o aviso).
create or replace function public.my_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.company_id from public.profiles p join public.companies c on c.id = p.company_id
  where p.id = auth.uid() and c.status = 'active';
$$;

create or replace function public.my_company_status()
returns text language sql stable security definer set search_path = public as $$
  select c.status from public.profiles p join public.companies c on c.id = p.company_id where p.id = auth.uid();
$$;
grant execute on function public.my_company_status() to authenticated;

-- Empresa de um perfil/serviço, para checagens dentro de policies (o RLS
-- de profiles esconderia a linha de quem é de outra empresa).
create or replace function public.profile_company(p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = p_id;
$$;
create or replace function public.service_company(p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.services where id = p_id;
$$;

-- Supervisor só enxerga a equipe enquanto for supervisor da mesma empresa.
create or replace function public.my_supervised_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
  where p.supervised_by = auth.uid() and p.company_id = public.my_company_id()
    and public.my_company_role() = 'supervisor';
$$;
drop policy if exists profiles_supervisor_scope on public.profiles;
create policy profiles_supervisor_scope on public.profiles
  for select using (id in (select public.my_supervised_ids()));

-- ---------- Entrar numa empresa ----------
create or replace function public.redeem_license_key(p_key text)
returns table(company_id uuid, company_name text)
language plpgsql security definer set search_path = public as $$
declare v_company record;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.'; end if;
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.company_id is not null) then
    raise exception 'Sua conta já faz parte de uma empresa.';
  end if;
  select c.id, c.name into v_company from public.companies c
    where upper(btrim(c.license_key)) = upper(btrim(p_key)) and c.status = 'active'
    for update;
  if v_company.id is null then raise exception 'Chave de licença não encontrada ou inativa.'; end if;
  -- A chave vale uma vez: com admin ativo, só com chave nova da plataforma.
  if exists (select 1 from public.profiles p where p.company_id = v_company.id and p.company_role = 'company_admin') then
    raise exception 'Esta licença já foi ativada. Peça uma chave nova ao administrador da plataforma.';
  end if;
  update public.profiles set company_id = v_company.id, company_role = 'company_admin', supervised_by = null where id = auth.uid();
  perform public.log_audit(v_company.id, 'company_admin_joined', jsonb_build_object('user_id', auth.uid()));
  return query select v_company.id, v_company.name;
end;
$$;

create or replace function public.redeem_invite_code(p_code text)
returns table(company_id uuid, company_name text)
language plpgsql security definer set search_path = public as $$
declare v_company record; v_seats_used int;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.'; end if;
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.company_id is not null) then
    raise exception 'Sua conta já faz parte de uma empresa. Peça para ser removido da anterior primeiro.';
  end if;
  -- "for update": dois convites ao mesmo tempo não furam o limite de vagas.
  select c.id, c.name, c.seats_limit into v_company from public.companies c
    where upper(btrim(c.collaborator_invite_code)) = upper(btrim(p_code)) and c.status = 'active'
    for update;
  if v_company.id is null then raise exception 'Código de convite não encontrado ou inativo.'; end if;
  select count(*) into v_seats_used from public.profiles p
    where p.company_id = v_company.id and p.company_role in ('collaborator', 'supervisor');
  if v_seats_used >= v_company.seats_limit then
    raise exception 'Essa empresa já atingiu o limite de % colaboradores.', v_company.seats_limit;
  end if;
  update public.profiles set company_id = v_company.id, company_role = 'collaborator', supervised_by = null where id = auth.uid();
  perform public.log_audit(v_company.id, 'collaborator_joined', jsonb_build_object('user_id', auth.uid()));
  return query select v_company.id, v_company.name;
end;
$$;
grant execute on function public.redeem_license_key(text) to authenticated;
grant execute on function public.redeem_invite_code(text) to authenticated;

-- ---------- Remover colaborador / mudar papel ----------
create or replace function public.remove_collaborator(p_collaborator_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller_company uuid := public.my_company_id(); v_target record;
begin
  if auth.uid() is null or v_caller_company is null or public.my_company_role() is distinct from 'company_admin' then
    raise exception 'Somente administradores da empresa podem remover colaboradores.';
  end if;
  if p_collaborator_id = auth.uid() then raise exception 'Você não pode remover a si mesmo.'; end if;
  select company_id, company_role into v_target from public.profiles where id = p_collaborator_id;
  if v_target.company_id is distinct from v_caller_company then
    raise exception 'Esse colaborador não pertence à sua empresa.';
  end if;
  update public.profiles set company_id = null, company_role = null, supervised_by = null where id = p_collaborator_id;
  -- Quem ele supervisionava fica sem supervisor; expediente aberto é encerrado.
  update public.profiles set supervised_by = null where supervised_by = p_collaborator_id;
  update public.courier_shifts set ended_at = now(), closed_by = auth.uid()
    where courier_id = p_collaborator_id and ended_at is null;
  perform public.release_planned_runs(p_collaborator_id);
  perform public.log_audit(v_caller_company, 'collaborator_removed', jsonb_build_object('collaborator_id', p_collaborator_id));
end;
$$;
revoke execute on function public.remove_collaborator(uuid) from public, anon;
grant execute on function public.remove_collaborator(uuid) to authenticated;

create or replace function public.set_collaborator_role(p_collaborator_id uuid, p_role text, p_supervised_by uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller_company uuid := public.my_company_id(); v_target record;
begin
  if auth.uid() is null or v_caller_company is null or public.my_company_role() is distinct from 'company_admin' then
    raise exception 'Somente administradores da empresa podem alterar papéis.';
  end if;
  if p_role is null or p_role not in ('collaborator', 'supervisor') then raise exception 'Papel inválido.'; end if;
  select company_id, company_role into v_target from public.profiles where id = p_collaborator_id;
  if v_target.company_id is distinct from v_caller_company then
    raise exception 'Essa pessoa não pertence à sua empresa.';
  end if;
  if v_target.company_role = 'company_admin' then
    raise exception 'O papel de um administrador não muda por aqui.';
  end if;
  if p_supervised_by is not null and not exists (
    select 1 from public.profiles where id = p_supervised_by and company_id = v_caller_company and company_role = 'supervisor') then
    raise exception 'O supervisor indicado não é válido para esta empresa.';
  end if;
  update public.profiles
    set company_role = p_role,
        supervised_by = case when p_role = 'collaborator' then p_supervised_by else null end
    where id = p_collaborator_id;
  -- Deixou de ser supervisor: a equipe dele fica sem supervisor.
  if p_role <> 'supervisor' then
    update public.profiles set supervised_by = null where supervised_by = p_collaborator_id;
  end if;
  perform public.log_audit(v_caller_company, 'collaborator_role_changed',
    jsonb_build_object('collaborator_id', p_collaborator_id, 'new_role', p_role));
end;
$$;
revoke execute on function public.set_collaborator_role(uuid, text, uuid) from public, anon;
grant execute on function public.set_collaborator_role(uuid, text, uuid) to authenticated;

-- Auditoria só é gravada pelas funções do banco.
revoke execute on function public.log_audit(uuid, text, jsonb) from public, anon, authenticated;

-- ---------- Avisos e acerto ----------
create or replace function public.notify_off_route(p_assignment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record; admin_id uuid;
begin
  select a.company_id, a.collaborator_id, p.name into v
    from public.assignments a left join public.profiles p on p.id = a.collaborator_id
    where a.id = p_assignment_id;
  if v.company_id is null or auth.uid() is null or v.collaborator_id is distinct from auth.uid() then return; end if;
  for admin_id in select id from public.profiles where company_id = v.company_id and company_role = 'company_admin' loop
    insert into public.notifications (company_id, user_id, type, title, message, assignment_id)
    values (v.company_id, admin_id, 'off_route', 'Possível desvio de rota',
      coalesce(v.name, 'O colaborador') || ' parece ter saído do trajeto previsto.', p_assignment_id);
  end loop;
end;
$$;

create or replace function public.preview_settlement(p_courier uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sem permissão.'; end if;
  if p_courier is distinct from auth.uid() and not exists (
    select 1 from public.profiles p where p.id = p_courier and p.company_id = public.my_company_id()
      and public.my_company_role() = 'company_admin') then
    raise exception 'Sem permissão.';
  end if;
  return public.compute_settlement(p_courier, p_from, p_to);
end;
$$;

-- Notificações só são criadas pelo banco (nenhuma tela insere direto).
drop policy if exists notifications_insert_within_company on public.notifications;

-- ---------- Posições do motoboy ----------
-- A hora da posição é a do servidor (não dá para inventar trajeto no passado).
create or replace function public.location_pings_server_time()
returns trigger language plpgsql as $$
begin
  if public.is_client_call() then new.recorded_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists trg_location_pings_server_time on public.location_pings;
create trigger trg_location_pings_server_time before insert on public.location_pings
  for each row execute function public.location_pings_server_time();

-- Km: ignora saltos acima de 2 km e trechos acima de 150 km/h (GPS errado ou fraude).
create or replace function public.courier_km(p_courier uuid, p_from timestamptz, p_to timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(round((sum(d) / 1000)::numeric, 2), 0)
  from (
    select public.geo_distance_m(lag(lat) over w, lag(lng) over w, lat, lng) as d,
           extract(epoch from recorded_at - lag(recorded_at) over w) as dt
    from public.location_pings
    where courier_id = p_courier and recorded_at >= p_from and recorded_at < p_to
    window w as (order by recorded_at)
  ) x
  where d is not null and d < 2000 and d <= greatest(dt, 1) * 41.7
$$;
revoke execute on function public.courier_km(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------- Chat ----------
-- Mensagem e chave sempre na empresa do colaborador da conversa; ninguém
-- reescreve mensagem (só marca como lida); a chave não muda de empresa.
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (
    sender_id = auth.uid()
    and company_id = public.profile_company(collaborator_id)
    and (
      collaborator_id = auth.uid()
      or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
      or collaborator_id in (select public.my_supervised_ids())
      or public.is_platform_admin()
    )
  );

create or replace function public.guard_chat_messages()
returns trigger language plpgsql as $$
begin
  if public.is_client_call() and not public.is_platform_admin()
     and (to_jsonb(new) - array['read_by_admin', 'read_by_collaborator'])
         is distinct from (to_jsonb(old) - array['read_by_admin', 'read_by_collaborator']) then
    raise exception 'Mensagem enviada não pode ser alterada.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_chat_messages on public.chat_messages;
create trigger trg_guard_chat_messages before update on public.chat_messages
  for each row execute function public.guard_chat_messages();

drop policy if exists chat_keys_room_access on public.chat_keys;
drop policy if exists chat_keys_read on public.chat_keys;
create policy chat_keys_read on public.chat_keys
  for select using (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or collaborator_id in (select public.my_supervised_ids())
    or public.is_platform_admin()
  );
drop policy if exists chat_keys_insert on public.chat_keys;
create policy chat_keys_insert on public.chat_keys
  for insert with check (
    company_id = public.profile_company(collaborator_id)
    and (
      collaborator_id = auth.uid()
      or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
      or collaborator_id in (select public.my_supervised_ids())
      or public.is_platform_admin()
    )
  );

-- ---------- Designações, folgas e fotos ----------
drop policy if exists assignments_admin_scope on public.assignments;
create policy assignments_admin_scope on public.assignments
  for all using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
  with check (
    company_id = public.my_company_id() and public.my_company_role() = 'company_admin'
    and (collaborator_id is null or public.profile_company(collaborator_id) = company_id)
    and (service_id is null or public.service_company(service_id) = company_id)
  );

drop policy if exists assignments_supervisor_scope on public.assignments;
create policy assignments_supervisor_scope on public.assignments
  for all using (company_id = public.my_company_id() and collaborator_id in (select public.my_supervised_ids()))
  with check (
    company_id = public.my_company_id() and collaborator_id in (select public.my_supervised_ids())
    and (service_id is null or public.service_company(service_id) = company_id)
  );

drop policy if exists collaborator_time_off_scope on public.collaborator_time_off;
create policy collaborator_time_off_scope on public.collaborator_time_off
  for all using (
    collaborator_id = auth.uid()
    or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
    or public.is_platform_admin()
  )
  with check (
    company_id = public.profile_company(collaborator_id)
    and (
      collaborator_id = auth.uid()
      or (company_id = public.my_company_id() and public.my_company_role() = 'company_admin')
      or public.is_platform_admin()
    )
  );

-- Fotos e assinatura: quem vê a designação vê e anexa; só o admin apaga.
drop policy if exists assignment_photos_company_scope on public.assignment_photos;
drop policy if exists assignment_photos_read on public.assignment_photos;
create policy assignment_photos_read on public.assignment_photos
  for select using (
    exists (select 1 from public.assignments a where a.id = assignment_id)
    and (company_id = public.my_company_id() or public.is_platform_admin())
  );
drop policy if exists assignment_photos_insert on public.assignment_photos;
create policy assignment_photos_insert on public.assignment_photos
  for insert with check (
    exists (select 1 from public.assignments a where a.id = assignment_id and a.company_id = company_id)
    and (company_id = public.my_company_id() or public.is_platform_admin())
    and uploaded_by = auth.uid()
  );
drop policy if exists assignment_photos_admin_delete on public.assignment_photos;
create policy assignment_photos_admin_delete on public.assignment_photos
  for delete using (
    (company_id = public.my_company_id() and public.my_company_role() = 'company_admin') or public.is_platform_admin()
  );

drop policy if exists assignment_photos_storage_access on storage.objects;
drop policy if exists assignment_photos_storage_read on storage.objects;
create policy assignment_photos_storage_read on storage.objects
  for select using (
    bucket_id = 'assignment-photos'
    and exists (select 1 from public.assignments a where a.id::text = (storage.foldername(name))[1])
  );
drop policy if exists assignment_photos_storage_insert on storage.objects;
create policy assignment_photos_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'assignment-photos'
    and exists (select 1 from public.assignments a where a.id::text = (storage.foldername(name))[1])
  );
drop policy if exists assignment_photos_storage_admin_delete on storage.objects;
create policy assignment_photos_storage_admin_delete on storage.objects
  for delete using (
    bucket_id = 'assignment-photos'
    and exists (select 1 from public.assignments a where a.id::text = (storage.foldername(name))[1]
                and ((a.company_id = public.my_company_id() and public.my_company_role() = 'company_admin') or public.is_platform_admin()))
  );

-- Marca própria: só imagens PNG, JPEG ou WebP (nada de SVG).
drop policy if exists company_branding_write on storage.objects;
create policy company_branding_write on storage.objects
  for all using (
    bucket_id = 'company-branding'
    and (storage.foldername(name))[1] = public.my_company_id()::text
    and public.my_company_role() = 'company_admin'
    and exists (select 1 from public.companies c where c.id = public.my_company_id() and c.feature_branding)
  )
  with check (
    bucket_id = 'company-branding'
    and (storage.foldername(name))[1] = public.my_company_id()::text
    and public.my_company_role() = 'company_admin'
    and lower(name) ~ '\.(png|jpe?g|webp)$'
    and exists (select 1 from public.companies c where c.id = public.my_company_id() and c.feature_branding)
  );

-- ---------- Perfil: colunas antigas também protegidas ----------
create or replace function public.guard_profiles()
returns trigger language plpgsql as $$
declare j_new jsonb; j_old jsonb;
begin
  if not public.is_client_call() or public.is_platform_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    j_new := to_jsonb(new);
    if coalesce(new.is_platform_admin, false) or new.company_id is not null
       or new.company_role is not null or new.supervised_by is not null
       or coalesce((j_new->>'is_admin')::boolean, false) or coalesce((j_new->>'wallet_balance')::numeric, 0) <> 0 then
      raise exception 'Perfil novo não pode vir com papel, empresa ou supervisor.';
    end if;
  else
    j_new := to_jsonb(new); j_old := to_jsonb(old);
    if new.is_platform_admin is distinct from old.is_platform_admin
       or new.company_id is distinct from old.company_id
       or new.company_role is distinct from old.company_role
       or new.supervised_by is distinct from old.supervised_by
       or j_new->'is_admin' is distinct from j_old->'is_admin'
       or j_new->'is_worker' is distinct from j_old->'is_worker'
       or j_new->'wallet_balance' is distinct from j_old->'wallet_balance' then
      raise exception 'Papel, empresa e supervisor só mudam pelas funções do sistema.';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- Avaliação do cliente ----------
-- O link de avaliação fica numa tabela só do gestor: o motoboy lia o próprio
-- link na designação e conseguia se dar nota. Nota só muda pelo link.
create table if not exists public.assignment_rating_tokens (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  token uuid not null unique default gen_random_uuid()
);
alter table public.assignment_rating_tokens enable row level security;
drop policy if exists assignment_rating_tokens_managers on public.assignment_rating_tokens;
create policy assignment_rating_tokens_managers on public.assignment_rating_tokens
  for select using (
    (company_id = public.my_company_id() and public.my_company_role() in ('company_admin', 'supervisor'))
    or public.is_platform_admin()
  );

insert into public.assignment_rating_tokens (assignment_id, company_id, token)
  select a.id, a.company_id, a.rating_token from public.assignments a where a.rating_token is not null
  on conflict (assignment_id) do nothing;
insert into public.assignment_rating_tokens (assignment_id, company_id)
  select a.id, a.company_id from public.assignments a
  where not exists (select 1 from public.assignment_rating_tokens t where t.assignment_id = a.id);
alter table public.assignments alter column rating_token drop default;
update public.assignments set rating_token = null where rating_token is not null;

create or replace function public.assignment_rating_token_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.assignment_rating_tokens (assignment_id, company_id) values (new.id, new.company_id)
    on conflict (assignment_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_assignment_rating_token on public.assignments;
create trigger trg_assignment_rating_token after insert on public.assignments
  for each row execute function public.assignment_rating_token_insert();

create or replace function public.guard_assignment_rating()
returns trigger language plpgsql as $$
begin
  if public.is_client_call() and not public.is_platform_admin()
     and (new.customer_rating is distinct from old.customer_rating
       or new.customer_feedback is distinct from old.customer_feedback
       or new.rated_at is distinct from old.rated_at
       or new.rating_token is distinct from old.rating_token) then
    raise exception 'A avaliação só é feita pelo cliente, pelo link.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_assignment_rating on public.assignments;
create trigger trg_guard_assignment_rating before update on public.assignments
  for each row execute function public.guard_assignment_rating();

create or replace function public.get_rating_context(p_token uuid)
returns table(service_name text, scheduled_start timestamptz, already_rated boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
  select s.name, a.scheduled_start, (a.customer_rating is not null)
  from public.assignment_rating_tokens t
  join public.assignments a on a.id = t.assignment_id
  join public.services s on s.id = a.service_id
  where t.token = p_token;
end;
$$;

create or replace function public.submit_rating(p_token uuid, p_rating int, p_feedback text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'A nota precisa ser de 1 a 5.'; end if;
  select a.id into v_id from public.assignment_rating_tokens t join public.assignments a on a.id = t.assignment_id
    where t.token = p_token and a.status = 'completed' and a.customer_rating is null
    for update of a;
  if v_id is null then raise exception 'Link inválido, expirado, ou este atendimento já foi avaliado.'; end if;
  update public.assignments set customer_rating = p_rating, customer_feedback = left(p_feedback, 2000), rated_at = now()
    where id = v_id;
end;
$$;

create or replace function public.get_rating_branding(p_token uuid)
returns table(company_name text, brand_color text, brand_logo_url text, brand_share_url text)
language sql stable security definer set search_path = public as $$
  select c.name,
         case when c.feature_branding then c.brand_color end,
         case when c.feature_branding then c.brand_logo_url end,
         case when c.feature_branding then c.brand_share_url end
  from public.assignment_rating_tokens t
  join public.companies c on c.id = t.company_id
  where t.token = p_token
$$;

-- Empresa suspensa continua vendo as próprias faturas (para poder pagar).
drop policy if exists license_invoices_company on public.license_invoices;
create policy license_invoices_company on public.license_invoices
  for select using (company_id = public.profile_company(auth.uid()) and public.my_company_role() = 'company_admin');

-- Motoboy de empresa suspensa também perde o acesso.
drop policy if exists assignments_collaborator_select on public.assignments;
create policy assignments_collaborator_select on public.assignments
  for select using (collaborator_id = auth.uid() and company_id = public.my_company_id());
drop policy if exists assignments_collaborator_update on public.assignments;
create policy assignments_collaborator_update on public.assignments
  for update using (collaborator_id = auth.uid() and company_id = public.my_company_id())
  with check (collaborator_id = auth.uid() and company_id = public.my_company_id());
drop policy if exists delivery_orders_courier_read on public.delivery_orders;
create policy delivery_orders_courier_read on public.delivery_orders
  for select using (courier_id = auth.uid() and company_id = public.my_company_id());

-- Logo da marca: só imagens comuns (SVG pode carregar script).
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'] where id = 'company-branding';
exception when others then raise notice 'tipos do bucket da marca não ajustados: %', sqlerrm;
end $$;

-- Foto/assinatura grava quem enviou mesmo se o app não mandar.
alter table public.assignment_photos alter column uploaded_by set default auth.uid();

-- ---------------------------------------------------------------------
-- Modo cozinha: tela cheia com a fila de preparo.
-- Abre com login de gestor ou por um link próprio da tela (sem login),
-- que só enxerga a fila de preparo: sem telefone, endereço nem valores.
-- O link fica numa tabela à parte (companies é lida pelos motoboys).
-- ---------------------------------------------------------------------
create table if not exists public.kitchen_displays (
  company_id uuid primary key references public.companies(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table public.kitchen_displays enable row level security;
drop policy if exists kitchen_displays_admin on public.kitchen_displays;
create policy kitchen_displays_admin on public.kitchen_displays
  for select using (company_id = public.my_company_id() and public.my_company_role() = 'company_admin');

-- Admin pega (ou troca, invalidando o link antigo) o link da tela da cozinha.
create or replace function public.kitchen_display_token(p_reset boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_token text;
begin
  if v_company is null or public.my_company_role() is distinct from 'company_admin' then
    raise exception 'Só o admin da empresa gera o link da cozinha.';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  if p_reset then
    insert into public.kitchen_displays (company_id, token) values (v_company, v_token)
      on conflict (company_id) do update set token = excluded.token, created_at = now();
  else
    insert into public.kitchen_displays (company_id, token) values (v_company, v_token)
      on conflict (company_id) do nothing;
  end if;
  select token into v_token from public.kitchen_displays where company_id = v_company;
  return v_token;
end;
$$;
revoke execute on function public.kitchen_display_token(boolean) from public, anon;
grant execute on function public.kitchen_display_token(boolean) to authenticated;

create or replace function public.kitchen_company(p_token text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if p_token is null then
    if public.is_order_manager() then return public.my_company_id(); end if;
    raise exception 'Sem permissão.';
  end if;
  select k.company_id into v from public.kitchen_displays k join public.companies c on c.id = k.company_id
    where k.token = p_token and length(p_token) >= 32 and c.status = 'active';
  if v is null then raise exception 'Link da cozinha inválido ou trocado. Peça o link novo ao admin.'; end if;
  return v;
end;
$$;
revoke execute on function public.kitchen_company(text) from public, anon, authenticated;

-- Fila de preparo (recebidos e em preparo, mais antigos primeiro) e os prontos recentes.
create or replace function public.kitchen_board(p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.kitchen_company(p_token);
begin
  return jsonb_build_object(
    'company', (select name from public.companies where id = v_company),
    'now', now(),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'number', o.number, 'order_type', o.order_type, 'status', o.status,
        'customer_name', o.customer_name, 'notes', o.notes, 'created_at', o.created_at,
        'items_text', o.items,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'name', i.name, 'variant', i.variant, 'quantity', i.quantity, 'notes', i.notes,
            'addons', (select coalesce(jsonb_agg(a->>'name'), '[]'::jsonb) from jsonb_array_elements(i.addons) a))
            order by i.position) from public.delivery_order_items i where i.order_id = o.id), '[]'::jsonb))
        order by o.created_at, o.number)
      from public.delivery_orders o
      where o.company_id = v_company and o.status in ('received', 'preparing') and o.run_id is null), '[]'::jsonb),
    'ready', coalesce((select jsonb_agg(jsonb_build_object('number', o.number, 'customer_name', o.customer_name, 'order_type', o.order_type)
        order by o.ready_at desc)
      from (select * from public.delivery_orders o
            where o.company_id = v_company and o.status = 'ready' and o.ready_at > now() - interval '2 hours'
            order by o.ready_at desc limit 12) o), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.kitchen_board(text) from public;
grant execute on function public.kitchen_board(text) to anon, authenticated;

-- Botão da cozinha: recebido → em preparo → pronto (só para a frente).
create or replace function public.kitchen_advance(p_order_id uuid, p_token text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.kitchen_company(p_token); v_status text;
begin
  update public.delivery_orders
    set status = case status when 'received' then 'preparing' else 'ready' end,
        ready_at = case when status = 'preparing' then coalesce(ready_at, now()) else ready_at end
    where id = p_order_id and company_id = v_company and run_id is null and status in ('received', 'preparing')
    returning status into v_status;
  if v_status is null then raise exception 'Pedido não está mais na fila de preparo.'; end if;
  return v_status;
end;
$$;
revoke execute on function public.kitchen_advance(uuid, text) from public;
grant execute on function public.kitchen_advance(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- SEGURANÇA — acesso anônimo fechado por padrão (06/10/2026).
-- O Supabase dá EXECUTE de toda função para anon. Aqui quem já podia
-- (logado) continua podendo, e o visitante sem login só chama as funções
-- das páginas públicas (avaliação e tela da cozinha) e as usadas pelas
-- regras de acesso. Funções novas também nascem fechadas para anon.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    begin
      if has_function_privilege('authenticated', r.fn, 'execute') then
        execute format('grant execute on function %s to authenticated', r.fn);
      end if;
      execute format('revoke execute on function %s from public, anon', r.fn);
    exception when others then
      raise notice 'permissão não revisada em %: %', r.fn, sqlerrm;
    end;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'get_rating_context(uuid)', 'submit_rating(uuid, integer, text)', 'get_rating_branding(uuid)',
    'kitchen_board(text)', 'kitchen_advance(uuid, text)',
    'is_platform_admin()', 'my_company_id()', 'my_company_role()', 'is_order_manager()',
    'my_supervised_ids()', 'is_client_call()', 'profile_company(uuid)', 'service_company(uuid)']
  loop
    if to_regprocedure('public.' || f) is not null then
      begin
        execute format('grant execute on function public.%s to anon', f);
      exception when others then
        raise notice 'grant falhou em %: %', f, sqlerrm;
      end;
    else
      raise notice 'função pública não encontrada: %', f;
    end if;
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public, anon;

-- Funções que rodam como dono (security definer) ficam com o search_path fixo,
-- para ninguém trocar uma tabela/função por outra de mesmo nome.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is null
      and pg_get_userbyid(p.proowner) = current_user
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    begin
      execute format('alter function %s set search_path = public, extensions', r.fn);
    exception when others then
      raise notice 'search_path não fixado em %: %', r.fn, sqlerrm;
    end;
  end loop;
end $$;

-- Atualiza o cache do Supabase (evita "Could not find the column ... in the schema cache").
notify pgrst, 'reload schema';
