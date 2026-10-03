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
  select id, name into v_company from public.companies where license_key = p_key and status = 'active';
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
  select id, name, seats_limit into v_company from public.companies where collaborator_invite_code = p_code and status = 'active';
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
