import axios from 'axios';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendApprovalRequest(data: {
  purchase_id: string;
  agent_id: string;
  amount: number;
  category: string;
  vendor: string;
  reason?: string;
  environment?: string;
  urgency?: string;
}): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[Telegram] Not configured. Skipping.');
    return false;
  }

  const urgencyEmoji = data.urgency === 'critical' ? '🔴' : data.urgency === 'low' ? '🟢' : '🟡';
  const envBadge = data.environment === 'production' ? '🔴 PROD' : '🟡 STAGING';

  const message =
    `${urgencyEmoji} *Nueva Solicitud de Compra*\n\n` +
    `${envBadge}\n` +
    `👤 *Agente:* \`${data.agent_id}\`\n` +
    `💰 *Monto:* $${data.amount} USD\n` +
    `🏷️ *Categoría:* ${data.category}\n` +
    `🏢 *Vendor:* ${data.vendor}\n` +
    (data.reason ? `📝 *Razón:* ${data.reason}\n` : '') +
    `\nID: \`${data.purchase_id}\``;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Aprobar', callback_data: `approve_${data.purchase_id}` },
        { text: '❌ Rechazar', callback_data: `reject_${data.purchase_id}` },
      ],
    ],
  };

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    console.log(`[Telegram] Solicitud enviada a ${CHAT_ID}`);
    return true;
  } catch (error) {
    console.error('[Telegram] Error enviando mensaje:', (error as any).response?.data || error);
    return false;
  }
}

export async function editApprovalMessage(
  chatId: number,
  messageId: number,
  originalText: string,
  action: 'approve' | 'reject',
  decisionBy: string
): Promise<void> {
  if (!BOT_TOKEN) return;

  const emoji = action === 'approve' ? '✅' : '';
  const verb = action === 'approve' ? 'aprobada' : 'rechazada';
  const newText = `${originalText}\n\n_${emoji} Decisión: ${verb} por ${decisionBy}_`;

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('[Telegram] Error editando mensaje:', err);
  }
}
