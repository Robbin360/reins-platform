-- =====================================================
-- REINS — SCHEMA COMPLETO (v0.2)
-- =====================================================
-- Instrucciones: pegá todo este archivo en Supabase → SQL Editor
-- y ejecutalo. Va a borrar las tablas existentes y recrearlas.
-- Si tenés datos importantes, haceles backup antes.
-- =====================================================

-- Extensiones
create extension if not exists "uuid-ossp";

-- =====================================================
-- LIMPIEZA (para idempotencia del script)
-- =====================================================
drop table if exists budget_usage cascade;
drop table if exists audit_log cascade;
drop table if exists purchase_requests cascade;
drop table if exists policies cascade;
drop table if exists agents cascade;
drop table if exists organizations cascade;

-- =====================================================
-- 1. ORGANIZACIONES
-- =====================================================
create table organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  telegram_chat_id text,
  telegram_bot_token text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =====================================================
-- 2. AGENTES
-- =====================================================
create table agents (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete cascade,
  agent_id text unique not null,
  display_name text,
  trust_level text default 'standard'
    check (trust_level in ('low', 'standard', 'high')),
  daily_budget_usd numeric default 0,
  monthly_budget_usd numeric default 0,
  created_at timestamptz default now()
);

create index idx_agents_agent_id on agents(agent_id);
create index idx_agents_org on agents(organization_id);

-- =====================================================
-- 3. POLÍTICAS
-- =====================================================
create table policies (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  description text,
  category text,
  vendor text,
  environment text check (environment in (null, 'staging', 'production')),
  urgency text check (urgency in ('low', 'normal', 'critical')),
  auto_approve_under numeric default 0,
  hard_block_above numeric,
  requires_approval boolean default false,
  block_weekends boolean default false,
  block_outside_hours boolean default false,
  work_hours_start int default 9,
  work_hours_end int default 18,
  work_hours_tz text default 'America/Argentina/Buenos_Aires',
  priority int default 100,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_policies_org on policies(organization_id);
create index idx_policies_active on policies(is_active);

-- =====================================================
-- 4. SOLICITUDES DE COMPRA
-- =====================================================
create table purchase_requests (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete set null,
  agent_id text not null,
  amount numeric not null,
  category text not null,
  vendor text not null,
  reason text,
  environment text default 'staging'
    check (environment in ('staging', 'production')),
  urgency text default 'normal'
    check (urgency in ('low', 'normal', 'critical')),
  status text not null default 'pending'
    check (status in ('approved', 'rejected', 'pending', 'expired')),
  decision_by text,
  decision_reason text,
  policy_id uuid references policies(id) on delete set null,
  created_at timestamptz default now(),
  decided_at timestamptz,
  expires_at timestamptz
);

create index idx_purchases_agent on purchase_requests(agent_id);
create index idx_purchases_status on purchase_requests(status);
create index idx_purchases_created on purchase_requests(created_at desc);
create index idx_purchases_org on purchase_requests(organization_id);

-- =====================================================
-- 5. AUDIT LOG (inmutable)
-- =====================================================
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  event_type text not null,
  entity_type text,
  entity_id uuid,
  actor text,
  actor_role text,
  metadata jsonb default '{}',
  ip_address text,
  created_at timestamptz default now()
);

create index idx_audit_event on audit_log(event_type);
create index idx_audit_entity on audit_log(entity_type, entity_id);
create index idx_audit_created on audit_log(created_at desc);

-- =====================================================
-- 6. PRESUPUESTOS (tracking en tiempo real)
-- =====================================================
create table budget_usage (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete cascade,
  agent_id text not null,
  category text,
  period text not null check (period in ('daily', 'monthly')),
  period_start date not null,
  amount_used numeric default 0,
  amount_approved numeric default 0,
  amount_pending numeric default 0,
  updated_at timestamptz default now(),
  unique(agent_id, category, period, period_start)
);

create index idx_budget_agent on budget_usage(agent_id);

-- =====================================================
-- 7. FUNCIONES Y TRIGGERS
-- =====================================================
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_policies_updated before update on policies
  for each row execute function update_updated_at_column();

create trigger trg_organizations_updated before update on organizations
  for each row execute function update_updated_at_column();

create or replace function log_audit(
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor text,
  p_actor_role text,
  p_metadata jsonb
) returns void as $$
begin
  insert into audit_log (event_type, entity_type, entity_id, actor, actor_role, metadata)
  values (p_event_type, p_entity_type, p_entity_id, p_actor, p_actor_role, p_metadata);
end;
$$ language plpgsql;

-- =====================================================
-- 8. DATOS DE EJEMPLO (seed)
-- =====================================================
insert into organizations (name, slug)
values ('Default Organization', 'default')
on conflict (slug) do nothing;

insert into policies (name, description, category, auto_approve_under, urgency, priority) values
  ('Critical urgency fast-track', 'Urgencia crítica aprobada hasta $500', null, 500, 'critical', 1);

insert into policies (name, description, environment, auto_approve_under, requires_approval, priority) values
  ('Production spend limit', 'Gasto en producción requiere aprobación sobre $100', 'production', 100, true, 3);

insert into policies (name, description, category, requires_approval, priority) values
  ('Hardware always requires approval', 'Todo hardware requiere aprobación humana', 'hardware', true, 5);

insert into policies (name, description, category, block_weekends, block_outside_hours, priority) values
  ('Block infrastructure on weekends', 'Infraestructura bloqueada fines de semana', 'infrastructure', true, true, 5);

insert into policies (name, description, category, auto_approve_under, priority) values
  ('Auto-approve software under $100', 'Software de bajo costo se aprueba solo', 'software', 100, 10);

-- =====================================================
-- 9. ROW LEVEL SECURITY (preparado para multi-tenant)
-- =====================================================
alter table organizations enable row level security;
alter table agents enable row level security;
alter table policies enable row level security;
alter table purchase_requests enable row level security;
alter table audit_log enable row level security;
alter table budget_usage enable row level security;
