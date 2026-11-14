# Reins Platform — Self-Hosted Security Gateway for MCP

This is the backend for [Reins](https://github.com/Robbin360/reins-mcp), the runtime security gateway for the Model Context Protocol (MCP). It evaluates every agent action against contextual security policies and either blocks, auto-approves, or routes it to a human for approval — with an append-only audit trail for compliance.

**Want to try it without hosting anything?** Use the public dry-run demo in the [reins-mcp README](https://github.com/Robbin360/reins-mcp#try-it-in-30-seconds). Self-host when you need the full human-in-the-loop flow (Telegram approvals) and your own audit data.

## Architecture

```
AI Agent → MCP Server (reins-mcp) → Reins API (this repo) → Your systems
                                          ↓
                                  [Policy Engine]
                                  [Blast Radius Eval]
                                          ↓
                          Block / Approve / Route to Human (Telegram)
                                          ↓
                              [Append-Only Audit Log (Supabase)]
```

## What's in this repo

- `schema.sql` — full Postgres schema (Supabase): policies, action_requests, append-only audit_log, budget tracking, and seed security policies
- `packages/api` — Express API: policy evaluation, action requests, Telegram webhook, audit trail

## Self-host setup

### 1. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com)
2. Open the SQL Editor and run the entire `schema.sql` from this repo
3. Grab your project URL and service key (Settings → API)

> ⚠️ `schema.sql` drops and recreates tables. Only run it on a fresh project, or back up first.

### 2. Telegram bot (for human approvals)

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the bot token
2. Get your chat ID (message the bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates`)
3. Generate a webhook secret (any long random string, e.g. `openssl rand -hex 32`)

### 3. API (Render or any Node host)

Deploy `packages/api` as a Node service:

```bash
cd packages/api
npm install
npm run build
node build/index.js
```

Set these environment variables:

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ | Supabase service key (bypasses RLS) |
| `REINS_API_KEY` | ✅ | Admin key — full access (create actions, approve, audit) |
| `REINS_DEMO_KEY` | optional | Public demo key — dry-run only, no side effects |
| `TELEGRAM_BOT_TOKEN` | for approvals | Bot token from BotFather |
| `TELEGRAM_CHAT_ID` | for approvals | Chat that receives approval requests |
| `TELEGRAM_WEBHOOK_SECRET` | for approvals | Secret to validate Telegram webhook calls (fail-closed) |
| `PORT` | optional | Default 3001 |

### 4. Register the Telegram webhook

After the API is live, register the webhook **with the secret**:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://YOUR-API/webhook/telegram", "secret_token": "<YOUR_WEBHOOK_SECRET>"}'
```

The API rejects any webhook call that doesn't carry the matching secret (fail-closed).

### 5. Point your MCP client at your gateway

In your MCP config (Claude Desktop, Cursor, Windsurf), use your own URL and admin key:

```json
{
  "mcpServers": {
    "reins": {
      "command": "npx",
      "args": ["-y", "github:Robbin360/reins-mcp"],
      "env": {
        "REINS_API_URL": "https://YOUR-API",
        "REINS_API_KEY": "<YOUR_REINS_API_KEY>"
      }
    }
  }
}
```

## Security model

- **Contextual policies** — same action, different context, different decision (blast radius, sensitivity, environment, time-of-day)
- **Human-in-the-loop** — high-risk actions pause and route to Telegram with approve/reject buttons
- **Append-only audit log** — Postgres triggers reject UPDATE/DELETE/TRUNCATE on `audit_log`; even the application can't erase it. Only the DB owner can disable the triggers.
- **Webhook authentication** — Telegram callbacks are validated against a shared secret (fail-closed)
- **Demo isolation** — the optional demo key runs in dry-run mode: evaluates policies, creates no rows, sends no notifications

## Roadmap

- SSO integration (Okta, Entra ID, Google Workspace)
- Shadow MCP discovery and inventory
- Automated EU AI Act / SOC 2 compliance reports
- Slack/Teams approval workflows

## License

Apache 2.0
