import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase.js";
import axios from "axios";

const router = Router();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Este endpoint recibe los clicks de los botones de Telegram
router.post("/callback", async (req: Request, res: Response) => {
  const callbackQuery = req.body.callback_query;
  if (!callbackQuery) {
    return res.status(200).send("OK"); // Ignorar otros updates de Telegram
  }

  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data; // ej: "approve_123e4567-e89b..."

  if (!data || !data.includes("_")) {
    return res.status(200).send("OK");
  }

  const [action, purchaseId] = data.split("_");
  const newStatus = action === "approve" ? "approved" : "rejected";
  const decisionBy = `telegram_user_${chatId}`;

  // 1. Actualizar en Supabase
  const { error } = await supabase
    .from("purchase_requests")
    .update({
      status: newStatus,
      decision_by: decisionBy,
      decided_at: new Date().toISOString(),
    })
    .eq("id", purchaseId);

  if (error) {
    console.error("Error updating purchase:", error);
    return res.status(500).send("Error");
  }

  // 2. Responder a Telegram para quitar los botones y mostrar confirmación
  const replyText = action === "approve"
    ? `✅ Compra #${purchaseId.slice(0, 8)} aprobada.`
    : `❌ Compra #${purchaseId.slice(0, 8)} rechazada.`;

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
      chat_id: chatId,
      message_id: messageId,
      text: `${callbackQuery.message.text}\n\n_${replyText}_`,
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("Error editing Telegram message:", err);
  }

  res.status(200).send("OK");
});

export { router as telegramWebhookRouter };
