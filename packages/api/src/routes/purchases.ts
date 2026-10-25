import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { evaluatePolicy } from '../services/policy-engine.js';
import { sendApprovalRequest } from '../services/telegram.js';
import { logAudit } from '../services/audit.js';

const router = Router();

const PurchaseSchema = z.object({
  agent_id: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().min(1),
  vendor: z.string().min(1),
  reason: z.string().optional(),
  environment: z.enum(['staging', 'production']).optional(),
  urgency: z.enum(['low', 'normal', 'critical']).optional(),
  organization_id: z.string().uuid().optional(),
});

router.post('/request', async (req: Request, res: Response) => {
  const parse = PurchaseSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid input', details: parse.error });
    return;
  }

  const data = parse.data;

  // 1. Evaluar política
  const decision = await evaluatePolicy(data);

  // 2. Guardar en Supabase
  const { data: purchaseRecord, error: dbError } = await supabase
    .from('purchase_requests')
    .insert({
      agent_id: data.agent_id,
      amount: data.amount,
      category: data.category,
      vendor: data.vendor,
      reason: data.reason,
      environment: data.environment ?? 'staging',
      urgency: data.urgency ?? 'normal',
      organization_id: data.organization_id ?? null,
      status: decision.status,
      decision_by: decision.decision_by,
      decision_reason: decision.reason,
      policy_id: decision.policy_id ?? null,
      decided_at: decision.status === 'approved' ? new Date().toISOString() : null,
      expires_at: decision.expires_at ?? null,
    })
    .select()
    .single();

  if (dbError || !purchaseRecord) {
    console.error('[Purchases] DB Error:', dbError);
    res.status(500).json({ error: 'Failed to save purchase request' });
    return;
  }

  // 3. Audit trail
  await logAudit('purchase.created', 'purchase_request', purchaseRecord.id, data.agent_id, null, {
    ...data,
    decision,
  });

  // 4. Si está pendiente, notificar por Telegram
  if (decision.status === 'pending') {
    await sendApprovalRequest({
      purchase_id: purchaseRecord.id,
      agent_id: data.agent_id,
      amount: data.amount,
      category: data.category,
      vendor: data.vendor,
      reason: data.reason,
      environment: data.environment,
      urgency: data.urgency,
    });
  }

  res.json({
    status: decision.status,
    decision_by: decision.decision_by,
    reason: decision.reason,
    purchase_id: purchaseRecord.id,
    expires_at: decision.expires_at,
  });
});

router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('purchase_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('purchase_requests')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(data);
});

export { router as purchasesRouter };
