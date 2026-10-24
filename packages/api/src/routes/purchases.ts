import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { evaluatePolicy } from "../services/policy-engine.js";
import { sendApprovalRequest } from "../services/telegram.js";

const router = Router();

const PurchaseSchema = z.object({
  agent_id: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().min(1),
  vendor: z.string().min(1),
  reason: z.string().min(1),
});

router.post("/request", async (req: Request, res: Response) => {
  const parse = PurchaseSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input", details: parse.error });
    return;
  }

  const data = parse.data;

  // 1. Evaluar política
  const decision = await evaluatePolicy({
    agent_id: data.agent_id,
    category: data.category,
    amount: data.amount,
  });

  // 2. Guardar en Supabase
  const { data: purchaseRecord, error: dbError } = await supabase
    .from("purchase_requests")
    .insert({
      agent_id: data.agent_id,
      amount: data.amount,
      category: data.category,
      vendor: data.vendor,
      reason: data.reason,
      status: decision.status,
      decision_by: decision.decision_by,
      decision_reason: decision.reason,
      decided_at: decision.status === "approved" ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (dbError || !purchaseRecord) {
    console.error("DB Error:", dbError);
    res.status(500).json({ error: "Failed to save purchase request" });
    return;
  }

  // 3. Si está pendiente, enviar notificación a Telegram
  if (decision.status === "pending") {
    await sendApprovalRequest({
      purchase_id: purchaseRecord.id,
      agent_id: data.agent_id,
      amount: data.amount,
      category: data.category,
      vendor: data.vendor,
      reason: data.reason,
    });
  }

  // 4. Responder al MCP
  res.json({
    status: decision.status,
    decision_by: decision.decision_by,
    reason: decision.reason,
    purchase_id: purchaseRecord.id,
  });
});

export { router as purchasesRouter };
