import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';

const router = Router();

router.get('/:agent_id', async (req: Request, res: Response) => {
  const { agent_id } = req.params;
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.substring(0, 7) + '-01';

  const orgId = (req as any).orgId ?? null;
  let query = supabase
    .from('budget_usage')
    .select('*')
    .eq('agent_id', agent_id)
    .in('period_start', [today, monthStart]);

  if (orgId) query = query.eq('organization_id', orgId);

  const { data, error } = await query;

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

export { router as budgetRouter };
