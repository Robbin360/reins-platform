-- =====================================================
-- REINS — SCHEMA COMPLETO (v0.4 - Security Gateway multi-tenant)
-- =====================================================
-- Instrucciones: pegá todo este archivo en Supabase → SQL Editor
-- y ejecutalo. Es idempotente: no borra tablas ni datos existentes.
-- =====================================================

-- Extensiones
create extension if not exists "uuid-ossp";

-- =====================================================
-- 1. ORGANIZACIONES
-- =====================================================
create table if not exists organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  api_key_hash text unique,          -- hash sha256 de la API key del tenant (multi-tenant)
  telegram_chat_id text,
  telegram_bot_token text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =====================================================
-- 2. AGENTES
-- =====================================================
create table if not exists agents (
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

create index if not exists idx_agents_agent_id on agents(agent_id);
create index if not exists idx_agents_org on agents(organization_id);

-- =====================================================
-- 3. POLÍTICAS (orientadas a seguridad)
-- =====================================================
create table if not exists policies (
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

create index if not exists idx_policies_org on policies(organization_id);
create index if not exists idx_policies_active on policies(is_active);
create index if not exists idx_policies_action on policies(action_type);
create index if not exists idx_policies_sensitivity on policies(sensitivity_level);

-- =====================================================
-- 4. SOLICITUDES DE ACCIÓN (antes purchase_requests)
-- =====================================================
create table if not exists action_requests (
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

create index if not exists idx_actions_agent on action_requests(agent_id);
create index if not exists idx_actions_status on action_requests(status);
create index if not exists idx_actions_created on action_requests(created_at desc);
create index if not exists idx_actions_org on action_requests(organization_id);
create index if not exists idx_actions_type on action_requests(action_type);
create index if not exists idx_actions_sensitivity on action_requests(sensitivity_level);

-- =====================================================
-- 5. AUDIT LOG (append-only, protegido por trigger, multi-tenant)
-- =====================================================
create table if not exists audit_log (
  id uuid primary key default uuid_generate_v4(),
  event_type text not null,
  entity_type text,
  entity_id uuid,
  actor text,
  actor_role text,
  organization_id uuid references organizations(id) on delete set null,  -- tenant dueño del evento
  metadata jsonb default '{}',
  ip_address text,
  created_at timestamptz default now()
);

create index if not exists idx_audit_event on audit_log(event_type);
create index if not exists idx_audit_entity on audit_log(entity_type, entity_id);
create index if not exists idx_audit_created on audit_log(created_at desc);
create index if not exists idx_audit_org on audit_log(organization_id);

-- =====================================================
-- 6. PRESUPUESTOS (tracking de uso - adaptado a acciones)
-- =====================================================
create table if not exists budget_usage (
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

create index if not exists idx_budget_agent on budget_usage(agent_id);

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

create or replace trigger trg_policies_updated before update on policies
  for each row execute function update_updated_at_column();

create or replace trigger trg_organizations_updated before update on organizations
  for each row execute function update_updated_at_column();

create or replace function log_audit(
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor text,
  p_actor_role text,
  p_metadata jsonb,
  p_organization_id uuid default null
) returns void as $$
begin
  insert into audit_log (event_type, entity_type, entity_id, actor, actor_role, metadata, organization_id)
  values (p_event_type, p_entity_type, p_entity_id, p_actor, p_actor_role, p_metadata, p_organization_id);
end;
$$ language plpgsql;

-- =====================================================
-- 8. DATOS DE EJEMPLO (seed - políticas de seguridad)
-- =====================================================
insert into organizations (name, slug)
values ('Default Organization', 'default')
on conflict (slug) do nothing;

-- Políticas de seguridad (organization_id NULL = defaults globales que heredan todos los tenants)
-- Cada INSERT evita duplicados por nombre; los UPDATE corrigen instalaciones existentes.
insert into policies (name, description, action_type, environment, requires_approval, priority)
select 'Block production DB writes without human approval',
       'Cualquier write en base de datos de producción requiere aprobación humana',
       'db_write', 'production', true, 2
where not exists (
  select 1 from policies
  where organization_id is null and name = 'Block production DB writes without human approval'
);

insert into policies (name, description, action_type, sensitivity_level, environment, auto_approve, priority)
select 'Auto-approve staging read-only actions',
       'Lecturas en staging se auto-aprueban',
       'db_read', 'public', 'staging', true, 6
where not exists (
  select 1 from policies
  where organization_id is null and name = 'Auto-approve staging read-only actions'
);

insert into policies (name, description, action_type, sensitivity_level, requires_approval, priority)
select 'Payment API calls require approval',
       'Llamadas a APIs de pago requieren aprobación',
       'api_call', 'restricted', true, 3
where not exists (
  select 1 from policies
  where organization_id is null and name = 'Payment API calls require approval'
);

insert into policies (name, description, action_type, block_outside_hours, priority)
select 'Block data exports outside business hours',
       'Exports de datos bloqueados fuera de horario laboral',
       'data_export', true, 4
where not exists (
  select 1 from policies
  where organization_id is null and name = 'Block data exports outside business hours'
);

insert into policies (name, description, action_type, sensitivity_level, hard_block, priority)
select 'Hard block customer PII exports',
       'Exports de PII de clientes siempre bloqueados',
       'data_export', 'restricted', true, 1
where not exists (
  select 1 from policies
  where organization_id is null and name = 'Hard block customer PII exports'
);

insert into policies (name, description, action_type, environment, requires_approval, priority)
select 'Infrastructure provisioning requires approval',
       'Provisionar infraestructura en producción requiere aprobación',
       'infra_provision', 'production', true, 5
where not exists (
  select 1 from policies
  where organization_id is null and name = 'Infrastructure provisioning requires approval'
);

update policies
set action_type = 'db_write',
    target_resource = null,
    sensitivity_level = null,
    environment = 'production',
    requires_approval = true,
    auto_approve = false,
    hard_block = false,
    priority = 2,
    is_active = true
where organization_id is null
  and name = 'Block production DB writes without human approval';

update policies set priority = 6
where organization_id is null and name = 'Auto-approve staging read-only actions';
update policies set priority = 3
where organization_id is null and name = 'Payment API calls require approval';
update policies set priority = 4
where organization_id is null and name = 'Block data exports outside business hours';
update policies set priority = 1
where organization_id is null and name = 'Hard block customer PII exports';
update policies set priority = 5
where organization_id is null and name = 'Infrastructure provisioning requires approval';

-- =====================================================
-- 9. AISLAMIENTO MULTI-TENANT
-- =====================================================
-- El aislamiento se aplica en la capa de aplicación: cada query se scopea
-- por organization_id según la API key autenticada. La API usa la service key
-- de Supabase, que bypassa RLS; por eso no se presenta RLS como mecanismo de
-- aislamiento ni se habilita aquí.

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

create or replace trigger audit_log_no_mutation
before update or delete on audit_log
for each row execute function prevent_audit_mutation();

create or replace trigger audit_log_no_truncate
before truncate on audit_log
for each statement execute function prevent_audit_mutation();
