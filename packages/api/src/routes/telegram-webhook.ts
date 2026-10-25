import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { editApprovalMessage } from '../services/telegram.js';
import { logAudit } from '../services/audit.js';

const router = Router();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

router.post('/callback', async (req: Request, res: Response) => {
  const callbackQuery = req.body.callback_query;
  if (!callbackQuery) {
    return res.status(200).send('OK');
  }

  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  if (!data || !data.includes('_')) {
    return res.status(200).send('OK');
  }

  const [action, purchaseId] = data.split('_');
  if (!['approve', 'reject'].includes(action) || !purchaseId) {
    return res.status(200).send('OK');
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const decisionBy = `telegram_user_${chatId}`;

  // Actualizar en Supabase
  const { data: purchase, error } = await supabase
    .from('purchase_requests')
    .update({
      status: newStatus,
      decision_by: decisionBy,
      decided_at: new Date().toISOString(),
    })
    .eq('id', purchaseId)
    .eq('status', 'pending')
    .select()
    .single();

  if (error || !purchase) {
    console.error('[Webhook] Error updating:', error);
    return res.status(500).send('Error');
  }

  // Audit
  await logAudit('purchase.decided', 'purchase_request', purchaseId, decisionBy, 'telegram_approver', {
    action,
    previous_status: 'pending',
    new_status: newStatus,
  });

  // Editar mensaje en Telegram
  await editApprovalMessage(chatId, messageId, callbackQuery.message.text || '', action as 'approve' | 'reject', decisionBy);

  res.status(200).send('OK');
});

export { router as telegramWebhookRouter };
