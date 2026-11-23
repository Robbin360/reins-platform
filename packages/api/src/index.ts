import { policiesRouter } from './routes/policies.js';
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { policyRouter } from './routes/policy.js';
import { purchasesRouter } from './routes/purchases.js';
import { telegramWebhookRouter } from './routes/telegram-webhook.js';
import { auditRouter } from './routes/audit.js';
import { budgetRouter } from './routes/budget.js';
import { mcpRouter } from './routes/mcp.js';
import { orgsRouter } from './routes/orgs.js';
import { supabase } from './lib/supabase.js';
import { hashKey, keysEqual } from './lib/keys.js';

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json());

// Auth middleware: admin global, demo read-only, o tenant por hash de key
const API_KEY = process.env.REINS_API_KEY;
const DEMO_KEY = process.env.REINS_DEMO_KEY;

if (process.env.NODE_ENV === 'production' && !API_KEY) {
  console.error('FATAL: REINS_API_KEY required in production');
  process.exit(1);
}

app.use(async (req: Request, res: Response, next: NextFunction) => {
  // Endpoints públicos (incluye el claim de ownership de Glama, GET sin auth)
  if (req.path.startsWith('/webhook/telegram') || req.path === '/health' || (req.method === 'GET' && req.path === '/mcp/.well-known/glama.json')) {
    return next();
  }

  // Modo dev: sin keys configuradas, abierto solo fuera de producción
  if (!API_KEY && !DEMO_KEY) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'API authentication is not configured' });
    }
    return next();
  }

  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;

  // Admin global (key de entorno): ve todo, sin org
  if (keysEqual(token, API_KEY)) {
    (req as any).isAdmin = true;
    (req as any).orgId = null;
    return next();
  }

  // Demo: dry-run, solo defaults globales, sin tocar datos de tenants.
  // Scopeada a un org "nil" (UUID que no existe) para que get_audit_trail
  // devuelva vacío, approve/reject rechace cross-tenant, y policies solo vea defaults.
  if (keysEqual(token, DEMO_KEY)) {
    const allowed =
      (req.method === 'POST' && req.path === '/v1/policy/evaluate') ||
      (req.method === 'POST' && req.path === '/v1/purchases/request') ||
      (req.method === 'POST' && req.path === '/mcp');
    if (allowed) {
      (req as any).isDemo = true;
      (req as any).orgId = '00000000-0000-0000-0000-000000000000';
      return next();
    }
    return res.status(403).json({
      error: 'Demo key is read-only. Allowed: POST /v1/policy/evaluate, POST /v1/purchases/request (dry-run), POST /mcp (dry-run)',
    });
  }

  // Tenant: hash de la key -> organización (aislamiento multi-tenant)
  if (token) {
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('api_key_hash', hashKey(token))
      .maybeSingle();
    if (org) {
      (req as any).isTenant = true;
      (req as any).orgId = org.id;
      return next();
    }
  }

  return res.status(401).json({ error: 'Unauthorized' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.4.0' });
});

app.use('/v1/policy', policyRouter);
app.use('/v1/policies', policiesRouter);
app.use('/v1/purchases', purchasesRouter);
app.use('/v1/audit', auditRouter);
app.use('/v1/budget', budgetRouter);
app.use('/v1/orgs', orgsRouter);
app.use('/webhook/telegram', telegramWebhookRouter);
app.use('/mcp', mcpRouter);

app.listen(port, () => {
  console.log(`🚀 Reins API v0.4 listening on http://localhost:${port}`);
});
