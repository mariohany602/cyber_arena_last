# Cyber Arena — Project Notes

## Run

```bash
# Backend
cd backend
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --reload   # frontend Vite proxy → :8000

# Frontend
cd frontend
npm run dev
```

## Verification

```bash
# Frontend
cd frontend && npx tsc --noEmit && npx vite build

# Backend imports cleanly
cd backend && .venv/bin/python -c "import main; print('OK')"
```

## Real engines used by each tool

| Tool          | Backend engine                               |
|---------------|----------------------------------------------|
| Nmap          | `nmap` binary                                |
| Nikto         | `nikto` binary                               |
| Vuln scan     | `nmap --script vuln`                         |
| Directories   | `gobuster` (auto v1/v3 detection)            |
| FFUF          | `ffuf` binary                                |
| SQLMap        | `sqlmap` binary                              |
| Web crawler   | `requests` + BeautifulSoup                   |
| Subdomains    | crt.sh + HackerTarget + OTX + RapidDNS + Wayback + subfinder (parallel, IPv4-forced) |
| Nuclei        | `nuclei` binary at `/home/mariohany/go/bin/nuclei` |
| Traffic       | `/proc/net/{tcp,tcp6,udp,udp6,dev}` parsing  |

The wordlist used by gobuster/ffuf lives at `backend/wordlists/common.txt`.

## SOC integration — Wazuh (SIEM · XDR · Threat Intel)

The `/soc` page renders **three tabs** (SIEM, XDR, Threat Intel) sourced
natively from a Wazuh deployment. All traffic goes through our backend
(`backend/wazuh.py` · router `/api/soc/wazuh/*`), which:

1. Authenticates against the Wazuh **Dashboard** at `POST /auth/login`
2. Forwards Elasticsearch-compatible queries to the **Indexer** via the
   Dashboard's built-in **console proxy** (`POST /api/console/proxy`)
3. Normalizes Wazuh-specific sub-schemas (`rule.*`, `data.virustotal.*`,
   `data.misp.*`, `data.abuseipdb.*`, `data.syscheck.*`, `data.sca.*`,
   `wazuh-states-vulnerabilities-*`) into clean DTOs

This works even when the Indexer (port 9200) and Management API (port
55000) are firewalled off — only the Dashboard URL has to be reachable
from the cyber-arena backend host.

### Configuration (env vars on the backend)

```bash
export WAZUH_URL=https://<wazuh-dashboard-host>        # required
export WAZUH_USER=admin                                # Dashboard user
export WAZUH_PASSWORD='***'
export WAZUH_VERIFY_SSL=false                          # self-signed is normal
# Optional overrides
export WAZUH_ALERTS_INDEX='wazuh-alerts-*'
export WAZUH_VULN_INDEX='wazuh-states-vulnerabilities-*'
export WAZUH_MONITORING_INDEX='wazuh-monitoring-*'
export WAZUH_TIMESTAMP_FIELD='@timestamp'
```

Then restart the backend. The SOC page auto-refreshes config/health.

### Backend endpoints (all auth-protected)

| Endpoint | Purpose |
|---|---|
| `GET  /api/soc/wazuh/config`              | Non-secret config summary |
| `GET  /api/soc/wazuh/health`              | Cluster status + total alert count |
| `GET  /api/soc/wazuh/siem/summary`        | Counters by severity / unique agents / MITRE techniques |
| `POST /api/soc/wazuh/siem/alerts`         | Filtered alert list (severity, agent, rule_id, Lucene `q`) |
| `POST /api/soc/wazuh/siem/events_over_time` | Date-histogram, stacked by severity |
| `POST /api/soc/wazuh/siem/top`            | Terms aggregation on any field |
| `GET  /api/soc/wazuh/xdr/agents`          | Per-agent rollup (alerts, max level, severity mix) |
| `GET  /api/soc/wazuh/xdr/vulnerabilities` | Vulnerability Detector inventory |
| `GET  /api/soc/wazuh/xdr/fim`             | File Integrity Monitoring events |
| `GET  /api/soc/wazuh/xdr/sca`             | Security Configuration Assessment findings |
| `GET  /api/soc/wazuh/ti/summary`          | Cross-feed TI counters (VT, MISP, AbuseIPDB, URLhaus, …) |
| `GET  /api/soc/wazuh/ti/virustotal`       | Malicious VirusTotal hits |
| `GET  /api/soc/wazuh/ti/misp`             | MISP IOC matches |
| `GET  /api/soc/wazuh/ti/abuseipdb`        | AbuseIPDB reputation hits |
| `GET  /api/soc/wazuh/mitre/matrix`        | Per-technique hit counts for the heatmap |

### Severity mapping

Wazuh rule levels (0-15) are normalized to the platform's 5-bucket scheme:

| Rule level | Severity |
|------------|----------|
| 12–15 | critical |
| 9–11  | high |
| 7–8   | medium |
| 4–6   | low |
| 0–3   | info |

## TheHive integration (cross-platform — read-only mirror)

The `/thehive` page mirrors a remote **TheHive 4.x** instance read-only. The
frontend never speaks to TheHive directly — all calls go through the
cyber-arena backend (`backend/thehive.py`, router `/api/soc/thehive/*`),
which forwards the API key as `Authorization: Bearer <key>` and normalises
TheHive's severity (1..4) and TLP (0..3) into the platform's chip schemes.

### Configuration (env vars on the backend)

```bash
export THEHIVE_URL='http://<thehive-host>:9000'   # required
export THEHIVE_API_KEY='********'                 # required (Profile → API Key)
export THEHIVE_VERIFY_SSL=false                   # self-signed is normal
export THEHIVE_ORG=''                             # optional (TheHive 4 multi-org)
export THEHIVE_HTTP_TIMEOUT=20                    # optional
```

`run_app.sh` already exports defaults; override per environment via
`.env.local` or shell exports before running.

### Backend endpoints (all auth-protected)

| Endpoint | Purpose |
|---|---|
| `GET /api/soc/thehive/config`                       | Non-secret config summary |
| `GET /api/soc/thehive/health`                       | Probes `/api/status` on TheHive |
| `GET /api/soc/thehive/summary`                      | Aggregate counters for dashboard tiles |
| `GET /api/soc/thehive/cases`                        | List cases (range, sort, status, severity, q) |
| `GET /api/soc/thehive/cases/{id}`                   | Case detail |
| `GET /api/soc/thehive/cases/{id}/tasks`             | Tasks on a case |
| `GET /api/soc/thehive/cases/{id}/observables`       | Artifacts on a case |
| `GET /api/soc/thehive/alerts`                       | List alerts |
| `GET /api/soc/thehive/alerts/{id}`                  | Alert detail with observables |

### Severity / TLP normalisation

| TheHive severity | Platform |  | TheHive TLP | Platform |
|---|---|---|---|---|
| 4 | critical |  | 3 | red |
| 3 | high     |  | 2 | amber |
| 2 | medium   |  | 1 | green |
| 1 | low      |  | 0 | white |

## Legacy SOC integration — generic Elasticsearch (kept for reference)

The platform's `/soc` page renders SIEM data **natively** by calling
Elasticsearch through our backend (no iframe). Configure the Elastic
connection via env vars on the backend, then restart it:

```bash
# Required
export ELASTIC_URL=https://elk.example.com:9200
export ELASTIC_USER=elastic
export ELASTIC_PASSWORD=********

# Optional
export ELASTIC_VERIFY_SSL=false                 # self-signed certs
export ELASTIC_INDEX_PATTERN='logs-*,*beat-*'   # default for log search
export ELASTIC_ALERTS_INDEX='.alerts-security.alerts-*,.siem-signals-*'
export ELASTIC_TIMESTAMP_FIELD='@timestamp'

# Multi-tenant / "Client" selector (either or both)
export ELASTIC_CLIENT_FIELD='client.name'                 # field on documents
export ELASTIC_CLIENT_INDEX_REGEX='^logs-([^-]+)-.*'      # capture group 1 = client
```

When `ELASTIC_CLIENT_FIELD` and/or `ELASTIC_CLIENT_INDEX_REGEX` are set, a
**Client** dropdown appears on the SOC page. Picking a client adds an
OR-filter to every panel: documents whose `<client_field>` matches the
client OR whose `_index` is one of the matching indices.

Backend endpoints (all auth-protected, see `backend/soc_siem.py`):
`GET /api/soc/siem/{config,health,indices,clients,alerts}`,
`POST /api/soc/siem/{search,aggs/over_time,aggs/top}` — every data
endpoint accepts an optional `client` parameter.

EDR and SOAR tabs are placeholders until those backends are wired up.

### Legacy: Kibana iframe embedding (no longer used by /soc)

Kept here for reference. To allow embedding Kibana via `<iframe>`, edit
`kibana.yml` on the ELK host:

```yaml
# Replace <FRONTEND_ORIGIN> with the URL of the cyber-arena UI,
# e.g. http://127.0.0.1:5173 in dev or https://your-platform.example.com
server.customResponseHeaders:
  Content-Security-Policy: "frame-ancestors 'self' <FRONTEND_ORIGIN>"
  X-Frame-Options: ""   # leave blank to disable the legacy header
```

Then restart Kibana. Without this, the iframe will load but render blank.

### Generating shareable URLs in Kibana

In Kibana: open the dashboard → **Share** → **Permalinks** →
**Saved object** → copy. Append `&embed=true` (the SOC page does this
automatically when "Embed" mode is on) to hide the Kibana chrome.

### Configuring the URLs in the platform

Two ways:

1. **Per-user, runtime** — open `/soc`, click **Configure**, paste URLs.
   Stored in `localStorage`.
2. **Build-time defaults** — set these env vars before `npm run build`:
   ```
   VITE_KIBANA_SIEM_URL=http://elk.example.com:5601/app/dashboards#/view/<id>
   VITE_KIBANA_EDR_URL=http://elk.example.com:5601/app/dashboards#/view/<id>
   VITE_KIBANA_SOAR_URL=http://elk.example.com:5601/app/dashboards#/view/<id>
   ```

### Auth in the iframe

Kibana auth happens *inside* the iframe (e.g. its own login screen, or
SSO). The platform doesn't pass tokens through. If you want a
single-sign-on experience, configure Kibana's anonymous access or
SAML/OIDC pointing at the same IdP your platform uses.

## Database

SQLite at `backend/sql_app.db`. Tables created on import via
`Base.metadata.create_all`. Adding new columns to existing tables is
not auto-migrated — drop and recreate, or write a manual migration.

## Adding a new pentest tool

1. Add the endpoint in `backend/main.py`, returning the response through
   `record_scan("<key>", target, response, current_user)`.
2. Add a mapper to `backend/vuln_assessment.py` and register it in
   `TOOL_REGISTRY` so findings get normalized for assessment + PDF.
3. Add a page under `frontend/src/pages/` using the **`ToolShell`** scaffold
   (see "Tool page layout" below). Render `AssessmentPanel` in the findings slot.
4. Register the route in `router.tsx` and the tile in `data/tools.ts`.

## Tool page layout (Midnight Ops)

All tool pages use `ToolShell` from `frontend/src/components/tools/ToolShell.tsx`
which renders a three-pane layout: **params** (left) · **output** (center) ·
**findings** (right), wrapped in the shared `ToolLayout` chrome.

```tsx
import ToolShell, { Field, PaneHeader, TerminalCard, FindingCard, EmptyPane }
  from '../components/tools/ToolShell';

<ToolShell
  title="Nmap"
  icon={Radar}
  subtitle="Network discovery & service fingerprinting"
  status={loading ? 'running' : results.length ? 'completed' : 'idle'}
  runLabel="Execute scan"
  onRun={handleScan}
  runDisabled={loading || !target}
  summary={<SummaryCards />}      // optional row above the panes
  params={<>...left form...</>}   // use <Field label=...> for each input
  output={<TerminalCard>...</TerminalCard>}  // live console + results table
  findings={<>...<FindingCard severity="high" .../></>}  // right rail
/>
```

Primitives exported alongside `ToolShell`:

| Primitive       | Purpose                                                  |
|-----------------|----------------------------------------------------------|
| `Field`         | Labeled input wrapper in the params pane                 |
| `PaneHeader`    | Title + hint inside any pane                             |
| `TerminalCard`  | macOS-style window for live engine output                |
| `FindingCard`   | Severity-tagged finding card for the right rail          |
| `EmptyPane`     | Centered icon + title + body for empty states            |
| `PipeTo`        | "Pipe to (SIEM, Slack, …)" checkbox group                |
| `ChevronCta`    | Small "View all →" chip                                  |

`Scanner.tsx` (Nmap) is the reference implementation. The migration recipe
for the remaining tool pages is:

1. Strip the old hand-rolled layout markup (keep all state + API logic).
2. Build three slot variables (`params`, `output`, `findings`).
3. Compute `status` from your loading/error/results flags.
4. Return `<ToolShell ... />`.

Colors come from the global Tailwind tokens (`brand-*`, `ui-*`, `neon-*`) —
never hard-code hex values; the palette is centrally defined in
`tailwind.config.js`.

## Generated PDF reports

Powered by `reportlab`. See `backend/report_pdf.py`.
