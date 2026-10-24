import axios from "axios";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendApprovalRequest(data: {
  purchase_id: string;
  agent_id: string;
  amount: number;
  category: string;
  vendor: string;
  reason: string;
}) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("Telegram bot not configured. Skipping notification.");
    return;
  }

  const message = `🚨 *Nueva Solicitud de Compra Pendiente*\n\n` +
    `👤 *Agente:* ${data.agent_id}\n` +
    `💰 *Monto:* $${data.amount} USD\n` +
    `🏷️ *Categoría:* ${data.category}\n` +
    `🏢 *Vendor:* ${data.vendor}\n` +
    `📝 *Razón:* ${data.reason}\n\n` +
    `ID de solicitud: \`${data.purchase_id}\``;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Aprobar", callback_data: `approve_${data.purchase_id}` },
        { text: "❌ Rechazar", callback_data: `reject_${data.purchase_id}` }
      ]
    ]
  };

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
    console.log(`[Telegram] Solicitud enviada a ${CHAT_ID}`);
  } catch (error) {
    console.error("[Telegram] Error enviando mensaje:", error);
   }
}
