import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { logAudit } from '../services/audit.js';

const router = Router();

const PolicySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  action_type: z.string().optional(),
  target_resource: z.string().optional(),
  sensitivity_level: z.enum(['public','internal','confidential','restricted']).optional(),
  environment: z.enum(['staging','production']).optional(),
  requires_approval: z.boolean().optional(),
  auto_approve: z.boolean().optional(),
  hard_block: z.boolean().optional(),
  priority: z.number().optional(),
  work_hours_tz: z.string().optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const orgId = (req as any).orgId ?? null;
  let q = supabase.from('policies').select('*').order('priority', { ascending: true });
  if (orgId) q = q.or(`organization_id.is.null,organization_id.eq.${orgId}`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = PolicySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const orgId = (req as any).orgId ?? null;
  const isAdmin = Boolean((req as any).isAdmin);
  const organization_id = isAdmin ? (req.body.organization_id ?? null) : orgId;
  if (!isAdmin && organization_id === null) return res.status(403).json({ error: 'Only admin can create global policies' });
  const { data, error } = await supabase.from('policies').insert({ ...parsed.data, organization_id }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logAudit('policy.created', 'policy', data.id, 'human:rest', 'human', { name: parsed.data.name }, orgId);
  res.status(201).json(data);
});

router.put('/:id', async (req: Request, res: Response) => {
  const orgId = (req as any).orgId ?? null;
  const parsed = PolicySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  let q = supabase.from('policies').update(parsed.data).eq('id', req.params.id);
  if (orgId) q = q.eq('organization_id', orgId);
  const { data, error } = await q.select().single();
  if (error || !data) return res.status(404).json({ error: 'Policy not found or not accessible' });
  await logAudit('policy.updated', 'policy', data.id, 'human:rest', 'human', parsed.data, orgId);
  res.json(data);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const orgId = (req as any).orgId ?? null;
  let q = supabase.from('policies').update({ is_active: false }).eq('id', req.params.id);
  if (orgId) q = q.eq('organization_id', orgId);
  const { data, error } = await q.select().single();
  if (error || !data) return res.status(404).json({ error: 'Policy not found or not accessible' });
  await logAudit('policy.deleted', 'policy', data.id, 'human:rest', 'human', {}, orgId);
  res.json({ deleted: data.id });
});

export { router as policiesRouter };
