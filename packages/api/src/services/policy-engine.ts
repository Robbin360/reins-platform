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
    .order('priority', { ascending: true });

  if (organizationId) {
    query = query.or(`organization_id.is.null,organization_id.eq.${organizationId}`);
  }

  const { data: policies, error } = await query;

  if (error || !policies) {
    console.error('Policy fetch error:', error);
    return fallbackDecision(data);
  }

  for (const policy of policies) {
    if (!matchesPolicy(policy, data)) continue;

    if (policy.hard_block) {
      return {
        status: 'rejected',
        decision_by: `policy:${policy.id}`,
        reason: `Action blocked: ${policy.description || policy.name}`,
        policy_id: policy.id,
      };
    }

    if (policy.block_weekends && isWeekend()) {
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

  return {
    status: 'approved',
    decision_by: 'policy:default',
    reason: 'No matching policy — auto-approved',
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

function isWeekend(): boolean {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6;
}

function isOutsideWorkHours(policy: any): boolean {
  const now = new Date();
  const hour = now.getUTCHours();
  return hour < policy.work_hours_start || hour >= policy.work_hours_end;
}

function fallbackDecision(data: PurchaseRequest): PolicyDecision {
  if (data.sensitivity_level === 'restricted' || data.sensitivity_level === 'confidential') {
    return {
      status: 'pending',
      decision_by: 'fallback:human',
      reason: `Policy engine unavailable — ${data.sensitivity_level} sensitivity requires human review`,
    };
  }
  return {
    status: 'approved',
    decision_by: 'fallback:auto',
    reason: `Auto-approved (${data.sensitivity_level} sensitivity, policy engine unavailable)`,
  };
}
