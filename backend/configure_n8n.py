#!/usr/bin/env python3
"""
Configure n8n SOAR integration for Cyber Arena
"""
import sys
import os

def configure_n8n():
    """Interactive configuration for n8n"""

    print("=" * 60)
    print("Cyber Arena - n8n SOAR Integration Setup")
    print("=" * 60)
    print()

    # Get n8n URL
    default_url = "http://100.90.206.1:5678"
    n8n_url = input(f"Enter n8n URL [{default_url}]: ").strip() or default_url
    n8n_url = n8n_url.rstrip('/')

    # Get API key
    print("\nDo you have an n8n API key?")
    print("  (Generated in n8n: Settings → API → Generate API Key)")
    has_api_key = input("Have API key? (y/n) [n]: ").strip().lower() == 'y'

    api_key = ""
    if has_api_key:
        api_key = input("Enter n8n API key: ").strip()

    # Integration method
    print("\n" + "=" * 60)
    print("Integration Method")
    print("=" * 60)
    print("1. Webhook URLs (Recommended)")
    print("   - Simpler, more reliable")
    print("   - Each workflow has a direct webhook URL")
    print()
    print("2. API-based")
    print("   - Requires API key")
    print("   - Uses workflow IDs")
    print()

    method = input("Choose method (1/2) [1]: ").strip() or "1"

    config_lines = []
    config_lines.append("# n8n SOAR Configuration")
    config_lines.append(f"export N8N_URL=\"{n8n_url}\"")

    if api_key:
        config_lines.append(f"export N8N_API_KEY=\"{api_key}\"")

    config_lines.append("export N8N_VERIFY_SSL=\"false\"")
    config_lines.append("")

    if method == "1":
        print("\n" + "=" * 60)
        print("Webhook URLs Configuration")
        print("=" * 60)
        print("\nFor each action, enter the full webhook URL from n8n.")
        print("Example: http://100.90.206.1:5678/webhook/block-ip")
        print("(Press Enter to skip)")
        print()

        webhooks = {
            "N8N_WEBHOOK_BLOCK_IP": "Block IP webhook URL",
            "N8N_WEBHOOK_ISOLATE": "Isolate Endpoint webhook URL",
            "N8N_WEBHOOK_DISABLE_USER": "Disable User webhook URL",
        }

        for env_var, description in webhooks.items():
            url = input(f"{description}: ").strip()
            if url:
                config_lines.append(f"export {env_var}=\"{url}\"")

    elif method == "2" and api_key:
        print("\n" + "=" * 60)
        print("Workflow IDs Configuration")
        print("=" * 60)
        print("\nEnter the workflow ID for each action (optional).")
        print("You can find workflow IDs in n8n or leave blank.")
        print()

        workflows = {
            "N8N_WORKFLOW_BLOCK_IP": "Block IP workflow ID",
            "N8N_WORKFLOW_ISOLATE": "Isolate Endpoint workflow ID",
            "N8N_WORKFLOW_DISABLE_USER": "Disable User workflow ID",
        }

        for env_var, description in workflows.items():
            wf_id = input(f"{description}: ").strip()
            if wf_id:
                config_lines.append(f"export {env_var}=\"{wf_id}\"")

    # Output configuration
    print("\n" + "=" * 60)
    print("Configuration")
    print("=" * 60)
    print()

    config_text = "\n".join(config_lines)
    print(config_text)

    print("\n" + "=" * 60)
    print()

    # Save option
    save = input("Save to .env.n8n file? (y/n) [y]: ").strip().lower() != 'n'

    if save:
        env_file = os.path.join(os.path.dirname(__file__), ".env.n8n")
        with open(env_file, 'w') as f:
            f.write(config_text + "\n")
        print(f"\n✓ Configuration saved to: {env_file}")
        print("\nTo use this configuration:")
        print(f"  1. source {env_file}")
        print("  2. ./run_app.sh")
        print()
        print("Or add these lines to your run_app.sh script")

    # Test connection
    if api_key:
        test = input("\nTest connection now? (y/n) [y]: ").strip().lower() != 'n'

        if test:
            print("\nTesting connection...")
            try:
                from n8n_client import n8n_test_connection

                # Temporarily set env vars
                os.environ['N8N_URL'] = n8n_url
                os.environ['N8N_API_KEY'] = api_key
                os.environ['N8N_VERIFY_SSL'] = 'false'

                result = n8n_test_connection()

                if result.get('success'):
                    print(f"\n✓ {result['message']}")
                else:
                    print(f"\n✗ Connection failed: {result.get('error')}")
                    print(f"   {result.get('message', '')}")
            except Exception as e:
                print(f"\n✗ Test failed: {e}")

    print("\n" + "=" * 60)
    print("Setup Complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Create workflows in n8n")
    print("2. Configure webhook URLs or get workflow IDs")
    print("3. Restart the backend with the new configuration")
    print("\nSee N8N_INTEGRATION.md for detailed workflow examples")
    print()


if __name__ == "__main__":
    try:
        configure_n8n()
    except KeyboardInterrupt:
        print("\n\nSetup cancelled.")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        sys.exit(1)
