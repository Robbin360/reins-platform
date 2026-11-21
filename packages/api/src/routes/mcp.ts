import { Router, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { evaluatePolicy } from '../services/policy-engine.js';
import { logAudit } from '../services/audit.js';

const router = Router();

// Verificación de ownership de Glama: público, sin auth, sin redirect, antes del handler MCP.
// writeHead + end para mandar Content-Type exacto "application/json" (sin charset).
router.get('/.well-known/glama.json', (_req: Request, res: Response) => {
  const body = JSON.stringify({
    $schema: 'https://glama.ai/mcp/schemas/connector.json',
    claim: 'glama_claim_Qn_3Z1kTvojJm_b009R9swzBbS-20xi-e',
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
});

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
  const server = new McpServer({ name: 'reins', version: '0.4.0' });
  const isDemo = Boolean((req as any).isDemo);
  const orgId: string | null = (req as any).orgId ?? null;

  server.tool('check_policy', 'Dry-run security policy evaluation', actionShape, async (args) => {
    const decision = await evaluatePolicy(args as any, orgId);
    return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
  });

  server.tool('request_action', 'Request an action through the security gateway', actionShape, async (args) => {
    const decision = await evaluatePolicy(args as any, orgId);
    if (isDemo) {
      return { content: [{ type: 'text', text: JSON.stringify({ ...decision, demo: true }) }] };
    }
    const { data: row, error } = await supabase
      .from('action_requests')
      .insert({
        organization_id: orgId,
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
    await logAudit('action.created', 'action_request', row.id, args.agent_id, null, { ...args, decision }, orgId);
    return { content: [{ type: 'text', text: JSON.stringify({ ...row, decision }) }] };
  });

  server.tool('approve_action', 'Approve a pending action by id (human confirms in chat)', { id: z.string() }, async ({ id }) => {
    let query = supabase.from('action_requests').select('*').eq('id', id);
    if (orgId) query = query.eq('organization_id', orgId);
    const { data: existing, error: findErr } = await query.single();
    if (findErr || !existing) return { content: [{ type: 'text', text: 'Action not found or not accessible' }] };

    const { data: row, error } = await supabase
      .from('action_requests')
      .update({ status: 'approved', decision_by: 'human:chat', decision_reason: 'Approved via chat', decided_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error || !row) return { content: [{ type: 'text', text: 'Update failed' }] };
    await logAudit('action.decided', 'action_request', row.id, 'human:chat', 'human', { status: 'approved' }, orgId);
    return { content: [{ type: 'text', text: `APPROVED ${id}` }] };
  });

  server.tool('reject_action', 'Reject a pending action by id (human denies in chat)', { id: z.string() }, async ({ id }) => {
    let query = supabase.from('action_requests').select('*').eq('id', id);
    if (orgId) query = query.eq('organization_id', orgId);
    const { data: existing, error: findErr } = await query.single();
    if (findErr || !existing) return { content: [{ type: 'text', text: 'Action not found or not accessible' }] };

    const { data: row, error } = await supabase
      .from('action_requests')
      .update({ status: 'rejected', decision_by: 'human:chat', decision_reason: 'Rejected via chat', decided_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error || !row) return { content: [{ type: 'text', text: 'Update failed' }] };
    await logAudit('action.decided', 'action_request', row.id, 'human:chat', 'human', { status: 'rejected' }, orgId);
    return { content: [{ type: 'text', text: `REJECTED ${id}` }] };
  });

  server.tool('get_audit_trail', 'Read recent audit entries', { limit: z.number().min(1).max(200).optional() }, async ({ limit }) => {
    let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit ?? 20);
    if (orgId) query = query.eq('organization_id', orgId);
    const { data, error } = await query;
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  });

  server.tool('list_policies', 'List policies that apply to you (your own + global defaults)', {}, async () => {
    let q = supabase.from('policies').select('*').eq('is_active', true).order('priority', { ascending: true });
    if (orgId) q = q.or(`organization_id.is.null,organization_id.eq.${orgId}`);
    const { data, error } = await q;
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  });

  server.tool('add_policy', 'Create a security policy for your organization', {
    name: z.string(),
    description: z.string().optional(),
    action_type: z.string().optional(),
    target_resource: z.string().optional(),
    sensitivity_level: z.enum(['public', 'internal', 'confidential', 'restricted']).optional(),
    environment: z.enum(['staging', 'production']).optional(),
    requires_approval: z.boolean().optional(),
    auto_approve: z.boolean().optional(),
    hard_block: z.boolean().optional(),
    priority: z.number().optional(),
  }, async (args) => {
    if (isDemo) return { content: [{ type: 'text', text: 'Demo key cannot create policies. Use a tenant key.' }] };
    const { data, error } = await supabase.from('policies').insert({
      organization_id: orgId,
      name: args.name,
      description: args.description ?? null,
      action_type: args.action_type ?? null,
      target_resource: args.target_resource ?? null,
      sensitivity_level: args.sensitivity_level ?? null,
      environment: args.environment ?? null,
      requires_approval: args.requires_approval ?? false,
      auto_approve: args.auto_approve ?? false,
      hard_block: args.hard_block ?? false,
      priority: args.priority ?? 100,
    }).select().single();
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    await logAudit('policy.created', 'policy', data.id, 'human:chat', 'human', { name: args.name }, orgId);
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
