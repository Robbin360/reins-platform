import { Router, Request, Response } from "express";
import { z } from "zod";
import { evaluatePolicy } from "../services/policy-engine.js";

const router = Router();

const EvaluateSchema = z.object({
  agent_id: z.string().min(1),
  category: z.string().min(1),
  amount: z.number().positive(),
  vendor: z.string().optional(),
  reason: z.string().optional(),
});

router.post("/evaluate", async (req: Request, res: Response) => {
  const parse = EvaluateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input", details: parse.error });
    return;
  }

  const decision = await evaluatePolicy(parse.data);

  res.json({
    ...decision,
    input: parse.data,
  });
});

export { router as policyRouter };
