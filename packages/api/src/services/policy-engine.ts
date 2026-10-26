import { supabase } from '../lib/supabase.js';
import type { PolicyDecision, PurchaseRequest } from '../types/shared.js';

export async function evaluatePolicy(
  data: PurchaseRequest
): Promise<PolicyDecision> {
  const { data: policies, error } = await supabase
    .from('policies')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (error || !policies) {
    console.error('Policy fetch error:', error);
    return fallbackDecision(data);
  }

  for (const policy of policies) {
    if (!matchesPolicy(policy, data)) continue;

    // Regla: bloqueo por fin de semana
    if (policy.block_weekends && isWeekend()) {
      return {
        status: 'rejected',
        decision_by: `policy:${policy.id}`,
        reason: `Category '${data.category}' blocked on weekends by policy '${policy.name}'`,
        policy_id: policy.id,
      };
    }

    // Regla: bloqueo fuera de horario laboral
    if (policy.block_outside_hours && isOutsideWorkHours(policy)) {
      return {
        status: 'rejected',
        decision_by: `policy:${policy.id}`,
        reason: `Outside work hours (${policy.work_hours_start}-${policy.work_hours_end})`,
        policy_id: policy.id,
      };
    }

    // Regla: auto-aprobación por monto
    if (policy.auto_approve_under > 0 && data.amount <= policy.auto_approve_under) {
      return {
        status: 'approved',
        decision_by: `policy:${policy.id}`,
        reason: `Auto-approved (amount ${data.amount} <= ${policy.auto_approve_under})`,
        policy_id: policy.id,
      };
    }

    // Regla: bloqueo duro
    if (policy.hard_block_above !== null && data.amount > policy.hard_block_above) {
      return {
        status: 'rejected',
        decision_by: `policy:${policy.id}`,
        reason: `Amount ${data.amount} exceeds hard block limit ${policy.hard_block_above}`,
        policy_id: policy.id,
      };
    }

    // Regla: requiere aprobación humana
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

  // Sin política que aplique: aprobar por defecto (fail-open)
  return {
    status: 'approved',
    decision_by: 'policy:default',
    reason: 'No matching policy — auto-approved',
  };
}

function matchesPolicy(policy: any, data: PurchaseRequest): boolean {
  if (policy.category && policy.category !== data.category) return false;
  if (policy.vendor && policy.vendor !== data.vendor) return false;
  if (policy.environment && policy.environment !== data.environment) return false;
  if (policy.urgency && policy.urgency !== data.urgency) return false; // ← NUEVO: contexto de urgencia
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
  if (data.amount <= 100) {
    return {
      status: 'approved',
      decision_by: 'fallback:auto',
      reason: `Auto-approved (amount ${data.amount} <= 100)`,
    };
  }
  return {
    status: 'pending',
    decision_by: 'fallback:human',
    reason: 'Policy engine unavailable — requires human review',
  };
}
