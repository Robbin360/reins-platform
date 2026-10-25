import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

router.get('/purchase/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('entity_type', 'purchase_request')
    .eq('entity_id', req.params.id)
    .order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

export { router as auditRouter };
