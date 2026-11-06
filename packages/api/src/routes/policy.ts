import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { evaluatePolicy } from '../services/policy-engine.js';
import { logAudit } from '../services/audit.js';

const router = Router();

const EvaluateSchema = z.object({
  agent_id: z.string().min(1),
  action_type: z.string().min(1),
  target_resource: z.string().min(1),
  sensitivity_level: z.enum(['public', 'internal', 'confidential', 'restricted']),
  actor_identity: z.string().optional(),
  environment: z.enum(['staging', 'production']).optional(),
  urgency: z.enum(['low', 'normal', 'critical']).optional(),
});

router.post('/evaluate', async (req: Request, res: Response) => {
  const parse = EvaluateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid input', details: parse.error });
    return;
  }

  const data = parse.data;

  const decision = await evaluatePolicy({
    agent_id: data.agent_id,
    action_type: data.action_type,
    target_resource: data.target_resource,
    sensitivity_level: data.sensitivity_level,
    actor_identity: data.actor_identity,
    environment: data.environment,
    urgency: data.urgency,
  });

  // Solo auditar requests reales, no las de la demo key
  if (!(req as any).isDemo) {
    await logAudit('policy.evaluated', 'policy', decision.policy_id ?? null, data.agent_id, null, {
      ...data,
      decision,
    });
  }

  res.json(decision);
});

export { router as policyRouter };
