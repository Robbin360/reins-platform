import { Router, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { evaluatePolicy } from '../services/policy-engine.js';
import { logAudit } from '../services/audit.js';

const router = Router();

const actionShape = {
  agent_id: z.string(),
  action_type: z.string(),
  target_resource: z.string(),
  sensitivity_level: z.enum(['public', 'internal', 'confidential', 'restricted']),
  environment: z.enum(['staging', 'production']).optional(),
  urgency: z.enum(['low', 'normal', 'critical']).optional(),
  reason: z.string().optional(),
};

function buildServer(req: Request): McpServer {
  const server = new McpServer({ name: 'reins', version: '0.3.0' });
  const isDemo = Boolean((req as any).isDemo);

  server.tool('check_policy', 'Dry-run security policy evaluation', actionShape, async (args) => {
    const decision = await evaluatePolicy(args as any);
    return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
  });

  server.tool('request_action', 'Request an action through the security gateway', actionShape, async (args) => {
    const decision = await evaluatePolicy(args as any);
    if (isDemo) {
      return { content: [{ type: 'text', text: JSON.stringify({ ...decision, demo: true }) }] };
    }
    const { data: row, error } = await supabase
      .from('action_requests')
      .insert({
        agent_id: args.agent_id,
        action_type: args.action_type,
        target_resource: args.target_resource,
        sensitivity_level: args.sensitivity_level,
        environment: args.environment ?? 'staging',
        urgency: args.urgency ?? 'normal',
        reason: args.reason ?? null,
        status: decision.status,
        decision_by: decision.decision_by,
        decision_reason: decision.reason,
        policy_id: decision.policy_id ?? null,
        expires_at: decision.expires_at ?? null,
      })
      .select()
      .single();
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    await logAudit('action.created', 'action_request', row.id, args.agent_id, null, { ...args, decision });
    return { content: [{ type: 'text', text: JSON.stringify({ ...row, decision }) }] };
  });

  server.tool('approve_action', 'Approve a pending action by id (human confirms in chat)', { id: z.string() }, async ({ id }) => {
    const { data: row, error } = await supabase
      .from('action_requests')
      .update({ status: 'approved', decision_by: 'human:chat', decision_reason: 'Approved via chat', decided_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error || !row) return { content: [{ type: 'text', text: 'Action not found' }] };
    await logAudit('action.decided', 'action_request', row.id, 'human:chat', 'human', { status: 'approved' });
    return { content: [{ type: 'text', text: `APPROVED ${id}` }] };
  });

  server.tool('reject_action', 'Reject a pending action by id (human denies in chat)', { id: z.string() }, async ({ id }) => {
    const { data: row, error } = await supabase
      .from('action_requests')
      .update({ status: 'rejected', decision_by: 'human:chat', decision_reason: 'Rejected via chat', decided_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error || !row) return { content: [{ type: 'text', text: 'Action not found' }] };
    await logAudit('action.decided', 'action_request', row.id, 'human:chat', 'human', { status: 'rejected' });
    return { content: [{ type: 'text', text: `REJECTED ${id}` }] };
  });

  server.tool('get_audit_trail', 'Read recent audit entries', { limit: z.number().min(1).max(200).optional() }, async ({ limit }) => {
    const { data, error } = await supabase
      .from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit ?? 20);
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  });

  return server;
}

router.post('/', async (req: Request, res: Response) => {
  const server = buildServer(req);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

router.get('/', (_req, res) => res.status(405).json({ error: 'Method not allowed' }));
router.delete('/', (_req, res) => res.status(405).json({ error: 'Method not allowed' }));

export { router as mcpRouter };
