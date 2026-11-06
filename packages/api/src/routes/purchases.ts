import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { evaluatePolicy } from '../services/policy-engine.js';
import { logAudit } from '../services/audit.js';

const router = Router();

const ActionSchema = z.object({
  agent_id: z.string().min(1),
  action_type: z.string().min(1),
  target_resource: z.string().min(1),
  sensitivity_level: z.enum(['public', 'internal', 'confidential', 'restricted']),
  actor_identity: z.string().optional(),
  environment: z.enum(['staging', 'production']).optional(),
  urgency: z.enum(['low', 'normal', 'critical']).optional(),
  reason: z.string().optional(),
  organization_id: z.string().optional(),
});

router.post('/request', async (req: Request, res: Response) => {
  const parse = ActionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid input', details: parse.error });
    return;
  }

  const data = parse.data;
  const decision = await evaluatePolicy(data);

  const { data: row, error } = await supabase
    .from('action_requests')
    .insert({
      organization_id: data.organization_id ?? null,
      agent_id: data.agent_id,
      action_type: data.action_type,
      target_resource: data.target_resource,
      sensitivity_level: data.sensitivity_level,
      environment: data.environment ?? 'staging',
      urgency: data.urgency ?? 'normal',
      actor_identity: data.actor_identity ?? null,
      reason: data.reason ?? null,
      status: decision.status,
      decision_by: decision.decision_by,
      decision_reason: decision.reason,
      policy_id: decision.policy_id ?? null,
      expires_at: decision.expires_at ?? null,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  if (decision.status === 'pending') {
    await notifyHuman(row);
  }

  if (!(req as any).isDemo) {
    await logAudit('action.created', 'action_request', row.id, data.agent_id, null, {
      ...data,
      decision,
    });
  }

  res.json({ ...row, decision });
});

async function notifyHuman(row: any): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const text =
    `️ *Reins — Acción requiere aprobación*\n\n` +
    `*Agente:* ${row.agent_id}\n` +
    `*Acción:* ${row.action_type}\n` +
    `*Recurso:* ${row.target_resource}\n` +
    `*Sensibilidad:* ${row.sensitivity_level}\n` +
    `*Entorno:* ${row.environment}\n` +
    `*Motivo:* ${row.reason ?? '—'}\n\n` +
    `_Política:_ ${row.decision_reason}`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Aprobar', callback_data: `approve:${row.id}` },
              { text: '❌ Rechazar', callback_data: `reject:${row.id}` },
            ],
          ],
        },
      }),
    });
  } catch (err) {
    console.error('Telegram notify error:', err);
  }
}

export { router as purchasesRouter };
