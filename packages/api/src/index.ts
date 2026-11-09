import { policiesRouter } from './routes/policies.js';
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { policyRouter } from './routes/policy.js';
import { purchasesRouter } from './routes/purchases.js';
import { telegramWebhookRouter } from './routes/telegram-webhook.js';
import { auditRouter } from './routes/audit.js';
import { budgetRouter } from './routes/budget.js';

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json());

// Auth middleware: key completa + demo key de solo lectura
const API_KEY = process.env.REINS_API_KEY;
const DEMO_KEY = process.env.REINS_DEMO_KEY;

app.use((req: Request, res: Response, next: NextFunction) => {
  // Endpoints públicos
  if (req.path.startsWith('/webhook/telegram') || req.path === '/health') {
    return next();
  }

  // Modo dev: sin keys configuradas, abierto
  if (!API_KEY && !DEMO_KEY) return next();

  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;

  // Acceso completo (admin)
  if (API_KEY && token === API_KEY) return next();

  // Acceso demo: evaluar políticas, listarlas y dry-run de request_action (sin efectos secundarios)
  if (DEMO_KEY && token === DEMO_KEY) {
    const allowed =
      (req.method === 'POST' && req.path === '/v1/policy/evaluate') ||
      (req.method === 'GET' && req.path === '/v1/policies') ||
      (req.method === 'POST' && req.path === '/v1/purchases/request');
    if (allowed) {
      (req as any).isDemo = true;
      return next();
    }
    return res.status(403).json({
      error: 'Demo key is read-only. Allowed: POST /v1/policy/evaluate, POST /v1/purchases/request (dry-run) and GET /v1/policies',
    });
  }

  return res.status(401).json({ error: 'Unauthorized' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.2.0' });
});

app.use('/v1/policy', policyRouter);
app.use('/v1/policies', policiesRouter);
app.use('/v1/purchases', purchasesRouter);
app.use('/v1/audit', auditRouter);
app.use('/v1/budget', budgetRouter);
app.use('/webhook/telegram', telegramWebhookRouter);

app.listen(port, () => {
  console.log(`🚀 Reins API v0.2 listening on http://localhost:${port}`);
});
