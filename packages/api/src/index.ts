import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { policyRouter } from "./routes/policy.js";
import { purchasesRouter } from "./routes/purchases.js";
import { telegramWebhookRouter } from "./routes/telegram-webhook.js";

const app = express();
const port = parseInt(process.env.PORT || "3001", 10);

app.use(cors());
app.use(express.json());

// Middleware de autenticación para rutas protegidas
const API_KEY = process.env.REINS_API_KEY;

app.use((req: Request, res: Response, next: NextFunction) => {
  // El webhook de Telegram y el health check no necesitan auth
  if (req.path.startsWith("/webhook/telegram") || req.path === "/health") {
    return next();
  }

  // Si no hay key configurada, permitir todo (modo desarrollo local)
  if (!API_KEY) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Rutas
app.use("/v1/policy", policyRouter);
app.use("/v1/purchases", purchasesRouter);
app.use("/webhook/telegram", telegramWebhookRouter);

app.listen(port, () => {
  console.log(`🚀 Reins API listening on http://localhost:${port}`);
});
