# SOAR Troubleshooting Guide

## Common Issues and Solutions

### 1. Action Buttons Not Clickable / Grayed Out

**Symptoms:**
- "Run playbook" button is visible but not clickable
- Action buttons appear disabled (grayed out)
- No error message shown

**Cause:**
User doesn't have the required permissions (RBAC - Role-Based Access Control)

**Solution:**

#### Check User Role:
```bash
cd backend
.venv/bin/python << 'EOF'
from database import SessionLocal
from models import User

db = SessionLocal()
user = db.query(User).filter(User.email == "YOUR_EMAIL").first()
print(f"Role: {user.role}")
db.close()
EOF
```

#### Role Permissions:

| Role | Permissions |
|------|-------------|
| **readonly** | Can only view SOAR executions |
| **analyst** | Can only view (no execution) |
| **tier1** | Can execute low-risk actions |
| **tier2** | Can execute low-risk actions |
| **incident_responder** | Can execute all actions |
| **admin** | Full access to everything |

#### Upgrade User Role:
```bash
cd backend
.venv/bin/python << 'EOF'
from database import SessionLocal
from models import User

db = SessionLocal()
user = db.query(User).filter(User.email == "YOUR_EMAIL").first()
user.role = "admin"  # or "incident_responder"
db.commit()
db.close()
print("✅ Role updated! Logout and login again.")
EOF
```

**Important:** User must logout and login again for permissions to update!

---

### 2. Workflow Not Appearing in List

**Symptoms:**
- n8n workflow exists but doesn't show in platform
- Empty workflow list
- "Test Connection" shows error

**Cause:**
n8n API key not configured or incorrect

**Solution:**

#### Check Configuration:
```bash
grep N8N_API_KEY run_app.sh
```

Should show:
```bash
export N8N_API_KEY="${N8N_API_KEY:-your-actual-key}"
```

#### Test Connection:
```bash
cd backend
export N8N_URL="http://100.90.206.1:5678"
export N8N_API_KEY="your-api-key"
.venv/bin/python << 'EOF'
from n8n_client import n8n_test_connection, n8n_list_workflows

print("Testing connection...")
result = n8n_test_connection()
print(result)

print("\nListing workflows...")
workflows = n8n_list_workflows()
for wf in workflows:
    print(f"  - {wf['name']} (ID: {wf['id']}, Active: {wf['active']})")
EOF
```

#### Fix Steps:
1. Get API key from n8n: http://100.90.206.1:5678 → Settings → API
2. Edit `run_app.sh` and update `N8N_API_KEY`
3. Restart backend: `./run_app.sh`

---

### 3. "Test Connection" Fails

**Symptoms:**
- Error: "Cannot connect to n8n"
- Error: "Connection refused"
- Error: "401 Unauthorized"

**Causes & Solutions:**

#### A. n8n Not Running
```bash
curl http://100.90.206.1:5678
```
**Fix:** Start n8n service

#### B. Wrong URL
Check `run_app.sh`:
```bash
export N8N_URL="http://100.90.206.1:5678"  # Correct URL?
```

#### C. Wrong API Key
- Regenerate key in n8n Settings → API
- Update `run_app.sh`
- Restart backend

#### D. Firewall Blocking
```bash
telnet 100.90.206.1 5678
```
**Fix:** Check firewall rules

---

### 4. Workflow Execution Fails

**Symptoms:**
- Click Execute → Error
- Status shows "failed"
- No response from n8n

**Debugging:**

#### Check n8n Workflow is Active:
In n8n UI, make sure workflow has the ⚡ (lightning) icon activated.

#### Check Workflow Trigger:
- **Webhook trigger:** Check webhook URL is correct
- **Manual trigger:** Should work with API

#### View Execution Details:
In platform → SOAR Control Center → Execution History → Click on execution

#### Check n8n Logs:
```bash
# If n8n is in Docker:
docker logs n8n

# Check for errors during execution
```

#### Test Workflow Directly:
```bash
cd backend
export N8N_URL="http://100.90.206.1:5678"
export N8N_API_KEY="your-key"

.venv/bin/python << 'EOF'
from n8n_client import n8n_trigger_workflow

result = n8n_trigger_workflow(
    workflow_id="xkrOLh051EbuHWDl",
    payload={"test": "data"}
)
print(result)
EOF
```

---

### 5. Workflow Shows as "Inactive"

**Symptoms:**
- Workflow appears in list with `"active": false`
- Cannot execute workflow
- n8n shows workflow is not activated

**Solution:**

1. Open n8n: http://100.90.206.1:5678
2. Find your workflow
3. Click the **⚡ Activate** toggle (top right)
4. Workflow should turn green/active
5. Refresh platform page

---

### 6. Platform Shows "Shuffle" Instead of "n8n"

**Symptoms:**
- Badge shows "Shuffle not configured"
- Subtitle shows Shuffle URL
- n8n workflows not being used

**Cause:**
Platform prioritizes n8n, but will fall back to Shuffle if n8n isn't configured.

**Check Configuration:**
```bash
cd backend
.venv/bin/python << 'EOF'
import os
os.environ['N8N_URL'] = 'http://100.90.206.1:5678'
os.environ['N8N_API_KEY'] = 'your-key'

from n8n_client import n8n_configured
print(f"n8n configured: {n8n_configured()}")
EOF
```

**Fix:**
- Make sure `N8N_URL` is set in `run_app.sh`
- Restart backend
- Clear browser cache (Ctrl+Shift+R)

---

### 7. Actions Return "local_only" Status

**Symptoms:**
- Execution completes but status shows "local_only"
- No actual workflow triggered
- Message: "action logged locally only"

**Cause:**
Neither n8n nor Shuffle is properly configured, OR no workflow/webhook is mapped to the action.

**Solution:**

#### For Mapped Actions (Block IP, Isolate, etc.):
Add to `run_app.sh`:
```bash
# Option 1: Webhook (recommended)
export N8N_WEBHOOK_BLOCK_IP='http://100.90.206.1:5678/webhook/block-ip'

# Option 2: Workflow ID
export N8N_WORKFLOW_BLOCK_IP='xkrOLh051EbuHWDl'
```

#### For "Run Playbook":
Must provide workflow ID when executing (no pre-configuration needed).

---

## Permission Reference

### Required Permissions by Action:

| Action | Permission Required |
|--------|-------------------|
| View SOAR page | `soar.read` |
| Block IP | `soar.execute.low` |
| Isolate Endpoint | `soar.execute.high` |
| Disable User | `soar.execute.high` |
| Run Playbook | `soar.execute.low` |

### Grant Permissions:
```bash
cd backend
.venv/bin/python << 'EOF'
from database import SessionLocal
from models import User

db = SessionLocal()
user = db.query(User).filter(User.email == "user@example.com").first()

# Choose appropriate role:
user.role = "admin"              # Full access
# user.role = "incident_responder"  # SOAR + incident management
# user.role = "tier1"              # Low-risk SOAR only

db.commit()
db.close()
print("✅ Role updated. User must logout/login for changes to apply.")
EOF
```

---

## Quick Diagnostics Script

Save as `diagnose_soar.sh`:

```bash
#!/bin/bash
cd /home/ubuntu/cyber_arena_last/project-main/backend

echo "=== SOAR Diagnostics ==="
echo ""

echo "1. Checking n8n connectivity..."
curl -s http://100.90.206.1:5678 > /dev/null && echo "✅ n8n reachable" || echo "❌ n8n not reachable"

echo ""
echo "2. Checking configuration..."
grep -E "N8N_URL|N8N_API_KEY" ../run_app.sh | grep -v "^#"

echo ""
echo "3. Checking backend..."
curl -s http://127.0.0.1:8000/api/hello > /dev/null && echo "✅ Backend running" || echo "❌ Backend not running"

echo ""
echo "4. Testing n8n connection..."
export N8N_URL="http://100.90.206.1:5678"
export N8N_API_KEY=$(grep N8N_API_KEY ../run_app.sh | grep -v "^#" | cut -d'"' -f4)

.venv/bin/python << 'EOF'
from n8n_client import n8n_test_connection
result = n8n_test_connection()
if result.get('success'):
    print(f"✅ Connected: {result.get('workflow_count', 0)} workflows")
else:
    print(f"❌ Failed: {result.get('error', 'Unknown error')}")
EOF

echo ""
echo "=== End Diagnostics ==="
```

Run: `chmod +x diagnose_soar.sh && ./diagnose_soar.sh`

---

## Summary Checklist

When SOAR actions don't work, check:

- [ ] User has correct role (admin/incident_responder)
- [ ] User logged out and back in after role change
- [ ] n8n API key is configured in run_app.sh
- [ ] Backend has been restarted
- [ ] n8n service is running
- [ ] n8n workflow is activated (⚡ icon)
- [ ] Network connectivity to n8n
- [ ] Browser cache cleared (Ctrl+Shift+R)

---

## Getting Help

If issues persist:

1. Check backend logs:
   ```bash
   tail -f /tmp/run_app.log
   ```

2. Check browser console (F12) for errors

3. Test API directly:
   ```bash
   TOKEN="your-jwt-token"
   curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/soc/soar/test-connection
   ```

4. Review documentation:
   - `N8N_INTEGRATION.md` - Full integration guide
   - `N8N_SETUP_SUMMARY.md` - Quick start
   - `CHANGES_SUMMARY.md` - Technical details
