import { supabase } from "../lib/supabase.js";

export interface PolicyContext {
  agent_id: string;
  category: string;
  amount: number;
}

export interface PolicyDecision {
  status: "approved" | "pending" | "rejected";
  decision_by: string;
  reason: string;
  matched_policy_id: string | null;
}

/**
 * Precedencia (de más específica a más genérica):
 * 1. Política del agente + categoría exacta
 * 2. Política del agente sin categoría (aplica a todo)
 * 3. Política global de categoría (agent_id = null)
 * 4. Política global default (agent_id = null, category = null)
 */
export async function evaluatePolicy(ctx: PolicyContext): Promise<PolicyDecision> {
  // 1. Traemos todas las políticas que puedan aplicar (del agente o globales)
  const { data: policies, error } = await supabase
    .from("policies")
    .select("*")
    .or(`agent_id.eq.${ctx.agent_id},agent_id.is.null`);

  if (error || !policies) {
    return {
      status: "pending",
      decision_by: "system:error",
      reason: "Failed to fetch policies from database",
      matched_policy_id: null,
    };
  }

  // 2. Filtramos las que aplican al contexto actual
  const applicable = policies.filter((p) => {
    const agentMatch = p.agent_id === ctx.agent_id || p.agent_id === null;
    const categoryMatch = p.category === ctx.category || p.category === null; // <-- Aquí estaba el typo
    return agentMatch && categoryMatch;
  });

  // 3. Ordenamos por precedencia en JS (100% predecible)
  applicable.sort((a, b) => {
    // Agente específico gana a global (null)
    if (a.agent_id !== null && b.agent_id === null) return -1;
    if (a.agent_id === null && b.agent_id !== null) return 1;

    // Categoría específica gana a global (null)
    if (a.category !== null && b.category === null) return -1;
    if (a.category === null && b.category !== null) return 1;

    return 0;
  });

  const policy = applicable[0];

  if (!policy) {
    return {
      status: "pending",
      decision_by: "system:no_matching_policy",
      reason: "No policy found for this context",
      matched_policy_id: null,
    };
  }

  // 4. Evaluamos las reglas de la política ganadora

  // Regla A: Categoría bloqueada → siempre requiere humano
  if (policy.blocked) {
    return {
      status: "pending",
      decision_by: `policy:${policy.id}`,
      reason: `Category '${ctx.category}' is blocked by policy`,
      matched_policy_id: policy.id,
    };
  }

  // Regla B: Monto bajo el límite de auto-aprobación
  if (policy.max_auto_approve !== null && ctx.amount <= policy.max_auto_approve) {
    return {
      status: "approved",
      decision_by: `policy:${policy.id}`,
      reason: `Amount ${ctx.amount} <= auto-approve limit ${policy.max_auto_approve}`,
      matched_policy_id: policy.id,
    };
  }

  // Regla C: Monto sobre el límite (o sin límite configurado) → requiere humano
  return {
    status: "pending",
    decision_by: `policy:${policy.id}`,
    reason: policy.max_auto_approve !== null
      ? `Amount ${ctx.amount} exceeds auto-approve limit ${policy.max_auto_approve}`
      : "Policy requires human approval (no auto-approve limit configured)",
    matched_policy_id: policy.id,
  };
}
