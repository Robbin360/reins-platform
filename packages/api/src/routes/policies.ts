import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { logAudit } from '../services/audit.js';

const router = Router();

const PolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().nullish(),
  vendor: z.string().nullish(),
  environment: z.enum(['staging', 'production']).nullish(),
  auto_approve_under: z.number().default(0),
  hard_block_above: z.number().nullish(),
  requires_approval: z.boolean().default(false),
  block_weekends: z.boolean().default(false),
  block_outside_hours: z.boolean().default(false),
  work_hours_start: z.number().default(9),
  work_hours_end: z.number().default(18),
  priority: z.number().default(100),
  is_active: z.boolean().default(true),
});

// Listar políticas
router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('policies')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Crear política
router.post('/', async (req: Request, res: Response) => {
  const parse = PolicySchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Invalid input', details: parse.error });
  }

  const { data, error } = await supabase
    .from('policies')
    .insert(parse.data)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await logAudit('policy.created', 'policy', data.id, 'admin:api', null, parse.data);
  res.status(201).json(data);
});

// Actualizar política
router.put('/:id', async (req: Request, res: Response) => {
  const parse = PolicySchema.partial().safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Invalid input', details: parse.error });
  }

  const { data, error } = await supabase
    .from('policies')
    .update(parse.data)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(404).json({ error: 'Policy not found' });

  await logAudit('policy.updated', 'policy', data.id, 'admin:api', null, parse.data);
  res.json(data);
});

// Desactivar política (soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('policies')
    .update({ is_active: false })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(404).json({ error: 'Policy not found' });

  await logAudit('policy.deactivated', 'policy', data.id, 'admin:api', null, {});
  res.json(data);
});

export { router as policiesRouter };
