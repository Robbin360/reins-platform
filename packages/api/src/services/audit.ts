import { supabase } from '../lib/supabase.js';

export async function logAudit(
  eventType: string,
  entityType: string,
  entityId: string | null,
  actor: string,
  actorRole: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.rpc('log_audit', {
      p_event_type: eventType,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_actor: actor,
      p_actor_role: actorRole,
      p_metadata: metadata,
    });
  } catch (err) {
    console.error('[Audit] Error logging:', err);
  }
}
