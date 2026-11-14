-- =====================================================
-- REINS — SCHEMA COMPLETO (v0.3 - Security Gateway)
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
drop table if exists action_requests cascade;
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
  identity_provider text,  -- 'okta', 'azure_ad', 'google_workspace', null
  identity_subject text,   -- ID del usuario en el IdP
  created_at timestamptz default now()
);

create index idx_agents_agent_id on agents(agent_id);
create index idx_agents_org on agents(organization_id);

-- =====================================================
-- 3. POLÍTICAS (orientadas a seguridad)
-- =====================================================
create table policies (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  description text,

  -- Criterios de matching (seguridad)
  action_type text,  -- 'db_write', 'db_read', 'api_call', 'infra_provision', 'data_export'
  target_resource text,  -- 'production_db', 'stripe_api', 'aws_ec2', 'customer_pii'
  sensitivity_level text
    check (sensitivity_level in (null, 'public', 'internal', 'confidential', 'restricted')),
  environment text check (environment in (null, 'staging', 'production')),
  urgency text check (urgency in ('low', 'normal', 'critical')),

  -- Acciones de la política
  requires_approval boolean default false,
  auto_approve boolean default false,
  hard_block boolean default false,

  -- Restricciones temporales
  block_weekends boolean default false,
  block_outside_hours boolean default false,
  work_hours_start int default 9,
  work_hours_end int default 18,
  work_hours_tz text default 'America/Argentina/Buenos_Aires',

  -- Metadata
  priority int default 100,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_policies_org on policies(organization_id);
create index idx_policies_active on policies(is_active);
create index idx_policies_action on policies(action_type);
create index idx_policies_sensitivity on policies(sensitivity_level);

-- =====================================================
-- 4. SOLICITUDES DE ACCIÓN (antes purchase_requests)
-- =====================================================
create table action_requests (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete set null,
  agent_id text not null,

  -- Detalle de la acción
  action_type text not null,  -- 'db_write', 'db_read', 'api_call', etc.
  target_resource text not null,  -- 'production_db', 'stripe_api', etc.
  sensitivity_level text not null
    check (sensitivity_level in ('public', 'internal', 'confidential', 'restricted')),

  -- Contexto
  environment text default 'staging'
    check (environment in ('staging', 'production')),
  urgency text default 'normal'
    check (urgency in ('low', 'normal', 'critical')),
  actor_identity text,  -- ID del SSO corporativo si aplica
  reason text,

  -- Decisión
  status text not null default 'pending'
    check (status in ('approved', 'rejected', 'pending', 'expired')),
  decision_by text,
  decision_reason text,
  policy_id uuid references policies(id) on delete set null,

  -- Timestamps
  created_at timestamptz default now(),
  decided_at timestamptz,
  expires_at timestamptz
);

create index idx_actions_agent on action_requests(agent_id);
create index idx_actions_status on action_requests(status);
create index idx_actions_created on action_requests(created_at desc);
create index idx_actions_org on action_requests(organization_id);
create index idx_actions_type on action_requests(action_type);
create index idx_actions_sensitivity on action_requests(sensitivity_level);

-- =====================================================
-- 5. AUDIT LOG (append-only, protegido por trigger)
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
-- 6. PRESUPUESTOS (tracking de uso - adaptado a acciones)
-- =====================================================
create table budget_usage (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete cascade,
  agent_id text not null,
  action_type text,
  period text not null check (period in ('daily', 'monthly')),
  period_start date not null,
  actions_executed numeric default 0,
  actions_approved numeric default 0,
  actions_blocked numeric default 0,
  updated_at timestamptz default now(),
  unique(agent_id, action_type, period, period_start)
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
-- 8. DATOS DE EJEMPLO (seed - políticas de seguridad)
-- =====================================================
insert into organizations (name, slug)
values ('Default Organization', 'default')
on conflict (slug) do nothing;

-- Políticas de seguridad (reemplazan las de gasto)
insert into policies (name, description, action_type, sensitivity_level, requires_approval, priority) values
  ('Block production DB writes without human approval',
   'Cualquier write en base de datos de producción requiere aprobación humana',
   'db_write', 'restricted', true, 1);

insert into policies (name, description, action_type, sensitivity_level, environment, auto_approve, priority) values
  ('Auto-approve staging read-only actions',
   'Lecturas en staging se auto-aprueban',
   'db_read', 'public', 'staging', true, 10);

insert into policies (name, description, action_type, sensitivity_level, requires_approval, priority) values
  ('Payment API calls require approval',
   'Llamadas a APIs de pago requieren aprobación',
   'api_call', 'restricted', true, 2);

insert into policies (name, description, action_type, block_outside_hours, priority) values
  ('Block data exports outside business hours',
   'Exports de datos bloqueados fuera de horario laboral',
   'data_export', true, 3);

insert into policies (name, description, action_type, sensitivity_level, hard_block, priority) values
  ('Hard block customer PII exports',
   'Exports de PII de clientes siempre bloqueados',
   'data_export', 'restricted', true, 1);

insert into policies (name, description, action_type, environment, requires_approval, priority) values
  ('Infrastructure provisioning requires approval',
   'Provisionar infraestructura en producción requiere aprobación',
   'infra_provision', 'production', true, 2);

-- =====================================================
-- 9. ROW LEVEL SECURITY (preparado para multi-tenant)
-- =====================================================
alter table organizations enable row level security;
alter table agents enable row level security;
alter table policies enable row level security;
alter table action_requests enable row level security;
alter table audit_log enable row level security;
alter table budget_usage enable row level security;

-- =====================================================
-- 10. AUDIT LOG APPEND-ONLY (protección a nivel de base)
-- =====================================================
-- Rechaza UPDATE, DELETE y TRUNCATE sobre audit_log.
-- Solo el owner de la base puede deshabilitar estos triggers.
create or replace function prevent_audit_mutation()
returns trigger as $$
begin
  raise exception 'audit_log is append-only: % not allowed', TG_OP;
end;
$$ language plpgsql;

drop trigger if exists audit_log_no_mutation on audit_log;
create trigger audit_log_no_mutation
before update or delete on audit_log
for each row execute function prevent_audit_mutation();

drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate
before truncate on audit_log
for each statement execute function prevent_audit_mutation();
