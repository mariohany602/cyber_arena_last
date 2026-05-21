# n8n SOAR Integration - Setup Summary

## ✅ What Was Done

The Cyber Arena platform has been enhanced to support **n8n** as a SOAR (Security Orchestration, Automation, and Response) platform, alongside the existing Shuffle integration.

### Files Created/Modified

1. **`backend/n8n_client.py`** - New n8n integration client
   - Connection testing
   - Workflow triggering (both webhook and API methods)
   - Workflow listing
   - Execution status tracking

2. **`backend/soar.py`** - Enhanced SOAR module
   - Added n8n support alongside Shuffle
   - Automatic platform detection (uses n8n if configured, falls back to Shuffle)
   - Support for both webhook and API-based workflow triggering
   - Updated action catalog to support webhook URLs

3. **`run_app.sh`** - Updated configuration
   - Added n8n environment variables
   - Commented examples for webhook URLs

4. **Documentation**
   - `N8N_INTEGRATION.md` - Complete integration guide with examples
   - `backend/.env.n8n.example` - Example configuration file
   - `backend/configure_n8n.py` - Interactive configuration script

## 🚀 Quick Start

### Option 1: Interactive Setup (Recommended)

```bash
cd /home/ubuntu/cyber_arena_last/project-main/backend
.venv/bin/python configure_n8n.py
```

Follow the prompts to configure your n8n connection.

### Option 2: Manual Configuration

Edit `run_app.sh` and add your n8n details:

```bash
# Around line 65, update these variables:
export N8N_URL="http://100.90.206.1:5678"
export N8N_API_KEY="your-api-key-here"
export N8N_VERIFY_SSL="false"

# For webhook-based integration (recommended):
export N8N_WEBHOOK_BLOCK_IP='http://100.90.206.1:5678/webhook/block-ip'
export N8N_WEBHOOK_ISOLATE='http://100.90.206.1:5678/webhook/isolate-endpoint'
export N8N_WEBHOOK_DISABLE_USER='http://100.90.206.1:5678/webhook/disable-user'
```

Then restart the backend:
```bash
cd /home/ubuntu/cyber_arena_last/project-main
./run_app.sh
```

## 📋 Getting Your n8n API Key

1. Open n8n: http://100.90.206.1:5678
2. Click on your profile icon (bottom left)
3. Go to **Settings** → **API**
4. Click **Generate API Key**
5. Copy the key and use it in the configuration

## 🔌 Integration Methods

### Method A: Webhooks (Recommended)

**Pros:**
- Simpler to set up
- More reliable
- Direct workflow triggering
- No API key needed for triggering

**Setup:**
1. Create workflows in n8n with **Webhook** trigger nodes
2. Copy the webhook URL from each workflow
3. Set environment variables with the webhook URLs

Example n8n webhook URL:
```
http://100.90.206.1:5678/webhook/block-ip
```

### Method B: n8n API

**Pros:**
- Can list all workflows programmatically
- Can trigger any workflow by ID

**Setup:**
1. Generate API key in n8n
2. Set `N8N_API_KEY` environment variable
3. Optionally set workflow IDs in environment

## 🧪 Testing the Integration

### 1. Test Connection

```bash
# Get JWT token first (login to the platform)
TOKEN="your-jwt-token"

# Test SOAR connection
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/soc/soar/test-connection
```

Expected response:
```json
{
  "success": true,
  "platform": "n8n",
  "message": "Connected to n8n successfully. Found 3 workflows.",
  "url": "http://100.90.206.1:5678",
  "workflow_count": 3
}
```

### 2. Check Configuration

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/soc/soar/config
```

Should show:
```json
{
  "platform": "n8n",
  "n8n_configured": true,
  "n8n_url": "http://100.90.206.1:5678",
  "actions": [...]
}
```

### 3. List Workflows

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/soc/soar/workflows
```

### 4. Trigger Test Action

```bash
curl -X POST http://localhost:8000/api/soc/soar/execute \
  -H "Authorization: Bearer $TOKEN" \
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

## 📝 Creating n8n Workflows

See `N8N_INTEGRATION.md` for detailed workflow examples. Here's a minimal example:

### Simple Block IP Workflow

1. **Add Webhook Trigger**
   - Path: `/webhook/block-ip`
   - Method: POST
   - Respond: Wait for Workflow

2. **Add Function Node** (Process Input)
   ```javascript
   return [{
     json: {
       ip: $input.item.json.ip,
       reason: $input.item.json.reason,
       timestamp: new Date().toISOString()
     }
   }];
   ```

3. **Add Your Action Nodes**
   - HTTP Request to firewall
   - Send notification
   - Log to database
   - etc.

4. **Add Response Node**
   ```javascript
   return [{
     json: {
       success: true,
       message: 'IP blocked successfully',
       executionId: $execution.id
     }
   }];
   ```

5. **Activate the workflow** ⚡

## 🎯 Available SOAR Actions

The platform supports these built-in actions:

1. **Block IP** (`block_ip`)
   - Blocks an IP address on firewall/EDR
   - Parameters: `ip`, `duration`, `reason`

2. **Isolate Endpoint** (`isolate_endpoint`)
   - Quarantines a host via Wazuh/EDR
   - Parameters: `agent_id`, `reason`

3. **Disable User** (`disable_user`)
   - Disables a user account
   - Parameters: `username`, `reason`

4. **Run Playbook** (`run_playbook`)
   - Triggers any custom workflow
   - Parameters: `workflow_id`, `payload_json`

## 🔧 Troubleshooting

### "n8n not configured" error

**Solution:** Make sure you've set the environment variables and restarted the backend:
```bash
export N8N_URL="http://100.90.206.1:5678"
export N8N_API_KEY="your-key"
./run_app.sh
```

### "Cannot connect to n8n" error

**Check:**
1. n8n is running: `curl http://100.90.206.1:5678`
2. URL is correct in configuration
3. No firewall blocking the connection
4. Backend logs: `tail -f backend/logs/*.log`

### Webhook not triggering

**Check:**
1. Workflow is **activated** in n8n (lightning bolt icon)
2. Webhook URL is correct
3. Test webhook directly:
   ```bash
   curl -X POST http://100.90.206.1:5678/webhook/block-ip \
     -H "Content-Type: application/json" \
     -d '{"ip": "1.2.3.4", "reason": "test"}'
   ```

### API key not working

**Check:**
1. API access is enabled in n8n settings
2. Key was copied correctly (no extra spaces)
3. Key hasn't been revoked

## 📊 Viewing Executions

All SOAR actions are logged in the platform, regardless of whether they succeed:

1. **In the UI:** Navigate to SOC → SOAR Control Center → Executions
2. **Via API:**
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/soc/soar/executions
   ```

Each execution shows:
- Action performed
- Parameters used
- Status (pending/running/success/failed)
- Execution ID (for tracking in n8n)
- Timestamp
- User who triggered it

## 🔐 Security Notes

1. **Keep API keys secure** - Don't commit to version control
2. **Use HTTPS in production** - Set `N8N_VERIFY_SSL=true`
3. **Restrict webhook access** - Use authentication in n8n
4. **Validate all inputs** - In your n8n workflows
5. **Audit all actions** - Review execution logs regularly

## 📚 Next Steps

1. ✅ Get your n8n API key
2. ✅ Configure the integration (run `configure_n8n.py`)
3. ✅ Create your first workflow in n8n
4. ✅ Test the connection
5. ✅ Trigger a test action from the UI
6. ✅ Review execution logs
7. ✅ Create additional custom workflows

## 🆘 Need Help?

- **Detailed Guide:** See `N8N_INTEGRATION.md`
- **n8n Documentation:** https://docs.n8n.io
- **Backend Logs:** `/home/ubuntu/cyber_arena_last/project-main/backend/logs/`
- **Test Script:** Run the configuration wizard with `.venv/bin/python configure_n8n.py`

---

**Status: ✅ Integration Ready**

The platform is now configured to work with n8n. Just add your API key and workflow configurations to start automating your security response!
