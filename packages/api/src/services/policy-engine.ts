import { supabase } from '../lib/supabase.js';
import type { PolicyDecision, PurchaseRequest } from '../types/shared.js';

export async function evaluatePolicy(
  data: PurchaseRequest,
  organizationId?: string | null
): Promise<PolicyDecision> {
  // Scoping: políticas globales (org IS NULL) + políticas del tenant
  let query = supabase
    .from('policies')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });

  if (organizationId) {
    query = query.or(`organization_id.is.null,organization_id.eq.${organizationId}`);
  } else {
    // Sin tenant (admin): solo políticas globales, nunca las de otros tenants.
    query = query.is('organization_id', null);
  }

  const { data: policies, error } = await query;

  if (error || !policies) {
    console.error('Policy fetch error:', error);
    return fallbackDecision(data);
  }

  // Precedencia: primero las políticas propias del tenant, luego las globales.
  // Dentro de cada grupo ya vienen ordenadas por priority y created_at.
  const orderedPolicies = organizationId
    ? [
        ...policies.filter((policy) => policy.organization_id === organizationId),
        ...policies.filter((policy) => policy.organization_id === null),
      ]
    : policies;

  // Un hard_block global es un piso: ninguna regla del tenant puede sobreescribirlo.
  const globalHardBlock = orderedPolicies.find(
    (policy) => policy.organization_id === null && policy.hard_block && matchesPolicy(policy, data)
  );
  if (globalHardBlock) {
    return {
      status: 'rejected',
      decision_by: `policy:${globalHardBlock.id}`,
      reason: `Action blocked: ${globalHardBlock.description || globalHardBlock.name}`,
      policy_id: globalHardBlock.id,
    };
  }

  for (const policy of orderedPolicies) {
    if (!matchesPolicy(policy, data)) continue;

    if (policy.hard_block) {
      return {
        status: 'rejected',
        decision_by: `policy:${policy.id}`,
        reason: `Action blocked: ${policy.description || policy.name}`,
        policy_id: policy.id,
      };
    }

    if (policy.block_weekends && isWeekend(policy)) {
      return {
        status: 'rejected',
        decision_by: `policy:${policy.id}`,
        reason: `Action '${data.action_type}' blocked on weekends by policy '${policy.name}'`,
        policy_id: policy.id,
      };
    }

    if (policy.block_outside_hours && isOutsideWorkHours(policy)) {
      return {
        status: 'rejected',
        decision_by: `policy:${policy.id}`,
        reason: `Outside work hours (${policy.work_hours_start}-${policy.work_hours_end}): ${policy.description || policy.name}`,
        policy_id: policy.id,
      };
    }

    if (policy.auto_approve) {
      return {
        status: 'approved',
        decision_by: `policy:${policy.id}`,
        reason: `Auto-approved by policy: ${policy.description || policy.name}`,
        policy_id: policy.id,
      };
    }

    if (policy.requires_approval) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      return {
        status: 'pending',
        decision_by: `policy:${policy.id}`,
        reason: `Requires human approval: ${policy.description || policy.name}`,
        policy_id: policy.id,
        expires_at: expiresAt,
      };
    }
  }

  // Fail-closed para producción o datos sensibles cuando no hay ninguna regla.
  if (
    data.environment === 'production' ||
    data.sensitivity_level === 'confidential' ||
    data.sensitivity_level === 'restricted'
  ) {
    return {
      status: 'pending',
      decision_by: 'default:no-match',
      reason: 'No matching policy — production or sensitive action requires human review',
    };
  }

  return {
    status: 'approved',
    decision_by: 'default:no-match',
    reason: 'No matching policy — public/internal staging action auto-approved',
  };
}

function matchesPolicy(policy: any, data: PurchaseRequest): boolean {
  if (policy.action_type && policy.action_type !== data.action_type) return false;
  if (policy.target_resource && policy.target_resource !== data.target_resource) return false;
  if (policy.sensitivity_level && policy.sensitivity_level !== data.sensitivity_level) return false;
  if (policy.environment && policy.environment !== data.environment) return false;
  if (policy.urgency && policy.urgency !== data.urgency) return false;
  return true;
}

function getZonedDateParts(policy: any): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: policy.work_hours_tz ?? 'UTC',
    hour: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  return {
    hour: Number(parts.find((part) => part.type === 'hour')?.value),
    weekday: parts.find((part) => part.type === 'weekday')?.value ?? '',
  };
}

function isWeekend(policy: any): boolean {
  const { weekday } = getZonedDateParts(policy);
  return weekday === 'Sat' || weekday === 'Sun';
}

function isOutsideWorkHours(policy: any): boolean {
  const { hour } = getZonedDateParts(policy);
  return hour < policy.work_hours_start || hour >= policy.work_hours_end;
}

function fallbackDecision(data: PurchaseRequest): PolicyDecision {
  return {
    status: 'pending',
    decision_by: 'fallback:engine_unavailable',
    reason: `Policy engine unavailable — ${data.sensitivity_level} sensitivity requires human review`,
  };
}
