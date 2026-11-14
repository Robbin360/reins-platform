import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { logAudit } from '../services/audit.js';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  // Validación de origen: solo Telegram conoce el secreto.
  // Fail-closed: si la variable no está configurada, se rechaza todo.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const provided = req.headers['x-telegram-bot-api-secret-token'];
  if (!secret || provided !== secret) {
    console.error('Webhook rechazado: secreto inválido o ausente');
    res.sendStatus(401);
    return;
  }

  const update = req.body;

  // Respondemos rápido a Telegram para evitar reintentos
  res.sendStatus(200);

  if (!update?.callback_query) return;

  const callback = update.callback_query;
  const [action, requestId] = (callback.data ?? '').split(':');

  if (!action || !requestId) return;

  const approved = action === 'approve';
  const status = approved ? 'approved' : 'rejected';
  const decidedBy = `telegram_user_${callback.from?.id ?? 'unknown'}`;

  const { data: row, error } = await supabase
    .from('action_requests')
    .update({
      status,
      decision_by: decidedBy,
      decision_reason: approved ? 'Approved via Telegram' : 'Rejected via Telegram',
      decided_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select()
    .single();

  if (error || !row) return;

  // Editamos el mensaje original para reflejar la decisión
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;

  if (token && chatId && messageId) {
    const newText =
      `🛡️ *Reins — Acción ${approved ? 'APROBADA ✅' : 'RECHAZADA ❌'}*\n\n` +
      `*Agente:* ${row.agent_id}\n` +
      `*Acción:* ${row.action_type}\n` +
      `*Recurso:* ${row.target_resource}\n` +
      `*Sensibilidad:* ${row.sensitivity_level}\n\n` +
      `_Decisión: ${status} por ${decidedBy}_`;

    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: 'Markdown',
      }),
    }).catch(() => {});
  }

  await logAudit('action.decided', 'action_request', row.id, decidedBy, 'human', {
    status,
    action_type: row.action_type,
    target_resource: row.target_resource,
  });
});

export { router as telegramWebhookRouter };
