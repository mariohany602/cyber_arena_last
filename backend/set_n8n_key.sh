#!/bin/bash
# Quick script to configure n8n API key

echo "=============================================="
echo "  n8n API Key Configuration"
echo "=============================================="
echo ""
echo "Please provide your n8n API key:"
echo "(Get it from: http://100.90.206.1:5678 → Settings → API)"
echo ""
read -p "Enter API key: " API_KEY

if [ -z "$API_KEY" ]; then
    echo "❌ Error: API key cannot be empty"
    exit 1
fi

echo ""
echo "Updating run_app.sh with your API key..."

# Backup original file
cp ../run_app.sh ../run_app.sh.backup

# Update the N8N_API_KEY line
sed -i "s|export N8N_API_KEY=\"\${N8N_API_KEY:-}\"|export N8N_API_KEY=\"\${N8N_API_KEY:-$API_KEY}\"|g" ../run_app.sh

echo "✅ API key configured!"
echo ""
echo "Testing connection to n8n..."

# Test the connection
export N8N_URL="http://100.90.206.1:5678"
export N8N_API_KEY="$API_KEY"

.venv/bin/python << 'PYTHON'
import os
from n8n_client import n8n_test_connection

result = n8n_test_connection()
if result.get('success'):
    print(f"\n✅ {result['message']}")
    print(f"   Found {result.get('workflow_count', 0)} workflows")
else:
    print(f"\n❌ Connection failed: {result.get('error')}")
    print(f"   {result.get('message', '')}")
PYTHON

echo ""
echo "=============================================="
echo "Next steps:"
echo "1. Restart backend: cd .. && ./run_app.sh"
echo "2. Open UI: http://127.0.0.1:5173/soar-center"
echo "3. Your 'soar' workflow should now appear!"
echo "=============================================="
