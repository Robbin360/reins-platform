import { Router, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { hashKey } from '../lib/keys.js';

const router = Router();

const CreateOrgSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with dashes'),
});

router.post('/', async (req: Request, res: Response) => {
  // Solo la admin global puede provisionar tenants
  if (!(req as any).isAdmin) {
    res.status(403).json({ error: 'Only the global admin key can create organizations' });
    return;
  }

  const parse = CreateOrgSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid input', details: parse.error });
    return;
  }
  const { name, slug } = parse.data;

  // API key del tenant: la en claro se devuelve UNA sola vez (solo queda el hash)
  const rawKey = `reins_live_${randomBytes(32).toString('base64url')}`;
  const keyHash = hashKey(rawKey);

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ name, slug, api_key_hash: keyHash })
    .select('id, name, slug')
    .single();

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(201).json({
    organization: org,
    api_key: rawKey,
    warning: 'Store this key now. It is shown once and cannot be recovered (only its hash is kept).',
  });
});

export { router as orgsRouter };
