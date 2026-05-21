# n8n SOAR Integration Guide

This guide explains how to connect your n8n instance to Cyber Arena for automated SOAR (Security Orchestration, Automation, and Response) workflows.

## Prerequisites

- n8n instance running and accessible
- n8n API key (for API-based integration)
- OR webhook URLs from your n8n workflows (for webhook-based integration)

## Configuration

### Step 1: Set Environment Variables

Edit `run_app.sh` or set these environment variables before starting the backend:

```bash
# Required: n8n instance URL
export N8N_URL="http://100.90.206.1:5678"

# Required for API-based workflows: n8n API key
export N8N_API_KEY="your-api-key-here"

# Optional: SSL verification (set to false for self-signed certs)
export N8N_VERIFY_SSL="false"
```

### Step 2: Choose Integration Method

You can integrate n8n using two methods:

#### Method A: Webhook URLs (Recommended)

This method is simpler and more reliable. Each SOAR action triggers a specific n8n workflow via its webhook URL.

1. In n8n, create workflows with **Webhook** trigger nodes
2. Get the webhook URL for each workflow (e.g., `http://n8n:5678/webhook/block-ip`)
3. Set environment variables:

```bash
export N8N_WEBHOOK_BLOCK_IP='http://100.90.206.1:5678/webhook/block-ip'
export N8N_WEBHOOK_ISOLATE='http://100.90.206.1:5678/webhook/isolate-endpoint'
export N8N_WEBHOOK_DISABLE_USER='http://100.90.206.1:5678/webhook/disable-user'
```

#### Method B: n8n API

This method uses n8n's REST API to trigger workflows by their ID.

1. Enable API access in n8n settings
2. Generate an API key: Settings → API → Generate API Key
3. Set the API key in environment:

```bash
export N8N_API_KEY="your-api-key-here"
```

4. Configure workflow IDs (optional, can also be specified at runtime):

```bash
export N8N_WORKFLOW_BLOCK_IP='workflow-id-here'
export N8N_WORKFLOW_ISOLATE='workflow-id-here'
export N8N_WORKFLOW_DISABLE_USER='workflow-id-here'
```

### Step 3: Restart the Backend

```bash
cd /home/ubuntu/cyber_arena_last/project-main
./run_app.sh
```

## Creating n8n Workflows

### Example: Block IP Workflow

Create a workflow in n8n with the following structure:

1. **Webhook Trigger** (or Workflow trigger for API method)
   - Method: POST
   - Path: `/webhook/block-ip`
   - Response: Wait for workflow to finish

2. **Function Node** - Extract Parameters
   ```javascript
   const ip = $input.item.json.ip;
   const duration = $input.item.json.duration || 60;
   const reason = $input.item.json.reason || 'Security block';
   
   return [{
     json: {
       ip: ip,
       duration: duration,
       reason: reason,
       timestamp: new Date().toISOString()
     }
   }];
   ```

3. **HTTP Request** - Block IP on Firewall
   - Method: POST
   - URL: Your firewall API endpoint
   - Authentication: As required
   - Body: `{{ JSON.stringify($json) }}`

4. **Function Node** - Format Response
   ```javascript
   return [{
     json: {
       success: true,
       action: 'block_ip',
       ip: $('Extract Parameters').item.json.ip,
       message: 'IP blocked successfully',
       executionId: $execution.id
     }
   }];
   ```

5. **Respond to Webhook**
   - Status Code: 200
   - Response Body: `{{ $json }}`

### Example: Isolate Endpoint Workflow

1. **Webhook Trigger**
   - Path: `/webhook/isolate-endpoint`

2. **Extract Parameters**
   ```javascript
   const agentId = $input.item.json.agent_id;
   const reason = $input.item.json.reason;
   
   return [{
     json: { agentId, reason, timestamp: new Date().toISOString() }
   }];
   ```

3. **HTTP Request** - Trigger Wazuh Active Response
   ```
   POST https://wazuh-manager:55000/active-response
   Headers:
     Authorization: Bearer YOUR_WAZUH_TOKEN
   Body:
   {
     "command": "restart-ossec0",
     "arguments": [],
     "alert": {
       "agent": { "id": "{{ $json.agentId }}" }
     }
   }
   ```

4. **Format & Respond**

## Testing the Integration

### 1. Test Connection

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:8000/api/soc/soar/test-connection
```

Expected response:
```json
{
  "success": true,
  "platform": "n8n",
  "message": "Connected to n8n successfully. Found 5 workflows.",
  "url": "http://100.90.206.1:5678",
  "workflow_count": 5
}
```

### 2. List Available Workflows

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:8000/api/soc/soar/workflows
```

### 3. Trigger a Test Action

Via webhook:
```bash
curl -X POST http://localhost:8000/api/soc/soar/execute \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "block_ip",
    "params": {
      "ip": "192.168.1.100",
      "duration": 60,
      "reason": "Test block"
    }
  }'
```

## Workflow Payload Format

When Cyber Arena triggers your n8n workflows, it sends a JSON payload with the action parameters:

### Block IP
```json
{
  "ip": "192.168.1.100",
  "duration": 60,
  "reason": "Malicious activity detected"
}
```

### Isolate Endpoint
```json
{
  "agent_id": "001",
  "reason": "Suspected ransomware"
}
```

### Disable User
```json
{
  "username": "jdoe@company.com",
  "reason": "Account compromise"
}
```

## Troubleshooting

### Connection Failed

1. Check n8n is running: `curl http://100.90.206.1:5678`
2. Verify API key is correct
3. Check firewall rules allow connection
4. Review backend logs: `tail -f backend/logs/uvicorn.log`

### Workflows Not Listed

1. Ensure `N8N_API_KEY` is set
2. Verify API access is enabled in n8n
3. Check workflows are not empty/draft

### Webhook Not Triggering

1. Verify webhook is activated in n8n (workflow must be active)
2. Check webhook URL is correct and includes the full path
3. Test webhook directly:
   ```bash
   curl -X POST http://100.90.206.1:5678/webhook/block-ip \
     -H "Content-Type: application/json" \
     -d '{"ip": "1.2.3.4", "reason": "test"}'
   ```

## Security Best Practices

1. **Use HTTPS** in production (set `N8N_VERIFY_SSL=true`)
2. **Rotate API keys** regularly
3. **Restrict webhook access** using n8n authentication
4. **Validate inputs** in your n8n workflows
5. **Log all actions** for audit trail
6. **Use separate credentials** for different integration points

## Advanced: Custom Actions

To add custom SOAR actions:

1. Edit `backend/soar.py` and add to `ACTION_CATALOG`:
   ```python
   "custom_action": {
       "label": "My Custom Action",
       "description": "Description here",
       "permission": "soar.execute.low",
       "webhook_env": "N8N_WEBHOOK_CUSTOM",
       "params": [
           {"key": "param1", "label": "Parameter 1", "type": "string", "required": True},
       ],
   }
   ```

2. Set webhook URL:
   ```bash
   export N8N_WEBHOOK_CUSTOM='http://100.90.206.1:5678/webhook/custom-action'
   ```

3. Create corresponding n8n workflow

4. Restart backend

## Support

For issues or questions:
- Check n8n logs: `docker logs n8n` (if running in Docker)
- Check Cyber Arena logs: `tail -f backend/logs/*.log`
- Review n8n workflow executions in the n8n UI
