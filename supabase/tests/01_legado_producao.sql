-- Simula tabelas do app antigo que já existem no banco de produção e que o
-- schema não pode alterar. A "orders" antiga (marketplace) não tem company_id.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  status text,
  "created_At" timestamptz default now(),
  worker_id uuid, user_id uuid,
  scheduled_date date, scheduled_time text, service_type text,
  price numeric, address text, neighborhood text, lat double precision, lng double precision,
  notes text, completion_code text,
  client_approved_start boolean, client_approved_end boolean, worker_started boolean,
  cancelled_by text, cancellation_reason text, penalty_applied boolean, penalty_amount numeric,
  service_started_at timestamptz, service_ended_at timestamptz,
  service_duration_minutes integer, scheduled_duration integer,
  transaction_id text, payment_status text, assas_payment_id text
);
insert into public.orders (status, price, address) values ('legado', 99, 'Rua Antiga, 1');

-- Demais tabelas do sistema anterior, só com as colunas listadas no banco de produção (2026-10-03).
alter table public.profiles add column if not exists company_id uuid;
alter table public.profiles add column if not exists company_role text check (company_role in ('company_admin', 'collaborator', 'supervisor'));
alter table public.profiles add column if not exists is_platform_admin boolean not null default false;
alter table public.profiles add column if not exists supervised_by uuid;
alter table public.profiles add column if not exists last_lat double precision, add column if not exists last_lng double precision, add column if not exists last_location_at timestamptz;
alter table public.profiles add column if not exists is_worker boolean, add column if not exists wallet_balance numeric, add column if not exists is_admin boolean, add column if not exists cpf text;
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  license_key text not null unique,
  collaborator_invite_code text not null unique,
  seats_limit integer not null default 5,
  status text not null default 'active' check (status in ('active', 'suspended')),
  notes text,
  created_at timestamptz not null default now()
);
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
  status text not null default 'scheduled',
  check (status in ('scheduled', 'en_route', 'in_progress', 'completed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.assignments add column if not exists customer_feedback text;
alter table public.assignments add column if not exists recurrence_group_id uuid;
alter table public.assignments add column if not exists rated_at timestamptz;
alter table public.assignments add column if not exists customer_rating smallint check (customer_rating between 1 and 5);
alter table public.assignments add column if not exists rating_token uuid default gen_random_uuid();
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null unique,
  label text,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.crm_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade unique,
  base_url text,
  api_key text,
  field_mapping jsonb default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
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
create table if not exists public.assignment_photos (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('before', 'after', 'signature')),
  url text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.collaborator_time_off (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_at timestamptz not null default now()
);
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
alter table public.profiles add constraint profiles_company_fk foreign key (company_id) references public.companies(id);
