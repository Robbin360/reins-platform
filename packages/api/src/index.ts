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

// Auth middleware
const API_KEY = process.env.REINS_API_KEY;

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/webhook/telegram') || req.path === '/health') {
    return next();
  }
  if (!API_KEY) return next();
  if (req.headers.authorization !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
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
