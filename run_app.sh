#!/bin/bash

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Prefer locally-installed Node 20+ (Vite requires >= 20.19/22.12) if present
if [ -x "$HOME/.local/node20/bin/node" ]; then
    export PATH="$HOME/.local/node20/bin:$PATH"
fi

# --- SOC / SIEM (Elasticsearch) configuration -------------------------------
# Pick up overrides from .env.local if present, otherwise use these defaults.
export ELASTIC_URL="${ELASTIC_URL:-http://192.168.1.220:9200}"
export ELASTIC_USER="${ELASTIC_USER:-elastic}"
export ELASTIC_PASSWORD="${ELASTIC_PASSWORD:-depi123}"
export ELASTIC_VERIFY_SSL="${ELASTIC_VERIFY_SSL:-false}"
# Indices in this stack look like flask-logs-*, generic-logs-*, snort-logs-*, etc.
export ELASTIC_INDEX_PATTERN="${ELASTIC_INDEX_PATTERN:-*-logs-*,logs-*,*beat-*}"
export ELASTIC_ALERTS_INDEX="${ELASTIC_ALERTS_INDEX:-.alerts-security.alerts-*,.internal.alerts-security.alerts-*,.siem-signals-*}"
# No multi-tenant tagging in current data — leave client scoping off for now.
# To enable later, set e.g.:
#   export ELASTIC_CLIENT_FIELD='client.name'
#   export ELASTIC_CLIENT_INDEX_REGEX='^logs-([^-]+)-.*'
export ELASTIC_CLIENT_FIELD="${ELASTIC_CLIENT_FIELD:-}"
export ELASTIC_CLIENT_INDEX_REGEX="${ELASTIC_CLIENT_INDEX_REGEX:-}"

# --- Wazuh (SIEM) configuration ---------------------------------------------
# Backend pulls SIEM data from a remote Wazuh Dashboard via its built-in
# console proxy to the indexer. Override per environment via .env.local.
export WAZUH_URL="${WAZUH_URL:-https://100.92.233.121}"
export WAZUH_USER="${WAZUH_USER:-admin}"
export WAZUH_PASSWORD="${WAZUH_PASSWORD:-FWrR0hcl?RQ8m8*K*0**3.Xtnqw9bPPq}"
export WAZUH_VERIFY_SSL="${WAZUH_VERIFY_SSL:-false}"

# --- TheHive (Case Management) configuration --------------------------------
# Read-only mirror — the cyber-arena backend pulls cases/alerts from a remote
# TheHive 4.x instance. Override per environment via .env.local.
export THEHIVE_URL="${THEHIVE_URL:-http://100.90.206.1:9000}"
export THEHIVE_API_KEY="${THEHIVE_API_KEY:-B7IEM3PvKRRHWldnqkf9yLkX1ojyatR2}"
export THEHIVE_VERIFY_SSL="${THEHIVE_VERIFY_SSL:-false}"
# Optional: TheHive 4 multi-org header (X-Organisation)
export THEHIVE_ORG="${THEHIVE_ORG:-}"

# --- Shuffle (SOAR) configuration -------------------------------------------
# The SOAR Control Center (/soar-center) talks to a remote Shuffle instance
# via Bearer-key auth. Workflows are listed and triggered through
# /api/v1/workflows/{id}/execute.
export SHUFFLE_URL="${SHUFFLE_URL:-http://100.90.206.1:3001}"
export SHUFFLE_API_KEY="${SHUFFLE_API_KEY:-42f39e90-f0e6-4f86-9843-f73c9e345b37}"
export SHUFFLE_VERIFY_SSL="${SHUFFLE_VERIFY_SSL:-false}"
# Optional: map playbook names to Shuffle workflow IDs (see backend/soar.py)
# export SHUFFLE_WORKFLOW_BLOCK_IP='<workflow-uuid>'
# export SHUFFLE_WORKFLOW_ISOLATE='<workflow-uuid>'
# export SHUFFLE_WORKFLOW_DISABLE_USER='<workflow-uuid>'

# --- n8n (SOAR) configuration -----------------------------------------------
# Alternative SOAR platform: n8n automation workflows.
# Configure these to use n8n instead of Shuffle. The platform will use n8n
# if N8N_URL is set, otherwise falls back to Shuffle.
export N8N_URL="${N8N_URL:-http://100.90.206.1:5678}"
export N8N_API_KEY="${N8N_API_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhY2QzYjFlOC1kNTVjLTRkZGUtOWRiZC01MzhkMjA0ZTc0ODkiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNjRhZGZlNmYtMzY0ZS00ZWU5LWIwMDItNTE3ZTkxNzk0ODZjIiwiaWF0IjoxNzc5MzcwOTAwfQ.OQAP9A91h9N1_3cwUKN_SKye9uK-nBr1cnr2b_lEi7Q}"
export N8N_VERIFY_SSL="${N8N_VERIFY_SSL:-false}"
# Optional: Webhook URLs for specific actions (preferred over API calls)
# These should be the full webhook URLs from your n8n workflows
# export N8N_WEBHOOK_BLOCK_IP='http://100.90.206.1:5678/webhook/block-ip'
# export N8N_WEBHOOK_ISOLATE='http://100.90.206.1:5678/webhook/isolate-endpoint'
# export N8N_WEBHOOK_DISABLE_USER='http://100.90.206.1:5678/webhook/disable-user'

# --- AI Assistant configuration -----------------------------------------------
# The Sentinel AI feature is configured to use Google Gemini via its OpenAI compatibility API.
export OPENAI_API_KEY="AIzaSyDiEfbkxlqkvXhQjIb1YVuqogZvjck40n8"
export OPENAI_API_URL="https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
export OPENAI_MODEL="gemini-flash-latest"

# Function to kill background processes on exit
cleanup() {
    echo "Stopping servers..."
    [ -n "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null
    [ -n "$FRONTEND_PID" ] && kill $FRONTEND_PID 2>/dev/null
    exit
}

# Trap SIGINT (Ctrl+C)
trap cleanup SIGINT SIGTERM

# Kill existing processes on specific ports to avoid conflicts
echo "Cleaning up existing processes on ports 8000 and 5173..."
fuser -k 8000/tcp 2>/dev/null
fuser -k 5173/tcp 2>/dev/null
fuser -k 5174/tcp 2>/dev/null

# Start Backend
echo "Starting Backend..."
cd "$SCRIPT_DIR/backend"
if [ -f ".venv/bin/python" ]; then
    PYTHON_BIN=".venv/bin/python"
elif [ -f "venv/bin/python" ]; then
    PYTHON_BIN="venv/bin/python"
else
    echo "No valid virtual environment found (checked .venv and venv)"
    exit 1
fi

$PYTHON_BIN -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Start Frontend
echo "Starting Frontend..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo "node_modules not found, running npm install..."
    npm install
fi

npm run dev -- --host 127.0.0.1 &
FRONTEND_PID=$!

echo "Both servers are running."
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "URL: http://127.0.0.1:5173"
echo "Press Ctrl+C to stop both."

wait
