import { supabase } from '../lib/supabase.js';

export interface ExpirableAction {
  id: string;
  status: string;
  expires_at: string | null;
}

export function isActionExpired(action: ExpirableAction, now = Date.now()): boolean {
  return (
    action.status === 'pending' &&
    Boolean(action.expires_at) &&
    new Date(action.expires_at as string).getTime() < now
  );
}

// Expiración lazy: al leer una acción vencida, la persistimos como expired.
export async function expireActionIfNeeded<T extends ExpirableAction>(action: T): Promise<T> {
  if (!isActionExpired(action)) return action;

  const { data } = await supabase
    .from('action_requests')
    .update({
      status: 'expired',
      decision_reason: 'Action expired before human decision',
    })
    .eq('id', action.id)
    .eq('status', 'pending')
    .select()
    .single();

  return (data as T | null) ?? ({ ...action, status: 'expired' } as T);
}
