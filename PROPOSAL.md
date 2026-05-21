# Cyber Arena — Project Proposal

## 1. What is Cyber Arena?

Cyber Arena is a complete cybersecurity platform we are building as one integrated project. It combines, in a single web application, the work of two security teams:

- **Red Team** — finds weaknesses (penetration testing).
- **Blue Team** — detects and responds to attacks (SOC, incident response).

Instead of using ten different tools in ten different windows, the analyst opens **one website**, runs the tools they need, and gets all the results — with risk scores, history, and a downloadable PDF report — in the same place.

## 2. The Problem

Today, security teams and students face three problems:

1. Every tool (Nmap, Nikto, Nuclei, SQLMap, …) has its own command line and its own output format.
2. Results are scattered across text files, so it is hard to see the full picture of one target.
3. Writing a clean report for the client takes hours of copy-paste.

Cyber Arena solves all three by putting the real tools behind one clean interface and one shared data model.

## 3. Project Plan 

The full project is organised in clear phases. Each phase builds on the previous one.

| Phase | Name                              | Goal                                                                 |
|-------|-----------------------------------|----------------------------------------------------------------------|
| 1     | Infrastructure & Network Security | Build the lab: each member has a VMware VM, all joined by VPN to a shared management network. Then connect the customer's assets (web server, email, Windows/Linux machines). |
| 2     | SOC Setup                         | Deploy Elastic SIEM (Elasticsearch + Logstash + Kibana), EDR, and SOAR. |
| 3     | Incident Response                 | Define playbooks and use the SOC to detect, contain, and recover from incidents. |
| 4     | Threat Intelligence               | Collect and use indicators of compromise to enrich detections.       |
| 5     | Penetration Testing               | Run real offensive tools against authorised targets.                 |
| 6     | Full Adversary Simulation         | Combine everything: Red Team attacks, Blue Team detects and responds, all on the same platform. |

The web application we are building is the **single control panel** for all of these phases.

## 4. What is Already Built

### 4.1 Red Team — 10 real penetration-testing tools

Every tool below runs the **real engine** on the server, not a simulation.

| Tool                  | Engine                                                              |
|-----------------------|---------------------------------------------------------------------|
| Nmap                  | `nmap`                                                              |
| Nikto                 | `nikto`                                                             |
| Nuclei (9000+ checks) | `nuclei`                                                            |
| SQLMap                | `sqlmap`                                                            |
| FFUF (fuzzer)         | `ffuf`                                                              |
| Directory enumeration | `gobuster`                                                          |
| Vulnerability scan    | `nmap --script vuln`                                                |
| Web crawler           | `requests` + BeautifulSoup                                          |
| Subdomain enumeration | crt.sh + HackerTarget + OTX + RapidDNS + Wayback + subfinder        |
| Traffic analyzer      | live parsing of `/proc/net/{tcp,udp,dev}`                           |

### 4.2 Blue Team — Native SOC dashboard

The `/soc` page talks **directly to Elasticsearch** (no iframe) and shows:

- Cluster health, indices, and security alerts.
- Time-series charts and top-N aggregations.
- A multi-tenant **Client selector** so one platform can serve many customers.
- A live network traffic view from the host machine.

EDR and SOAR tabs are already in place, ready to be connected to the chosen products.

### 4.3 Unified results — the key feature

This is the most important engineering piece. Whatever tool the user runs, its output is converted into the **same simple format**:

```
{ severity, title, description, location, evidence, references }
```

From this we automatically compute:

- A **risk score from 0 to 100** (CRITICAL = 25, HIGH = 12, MEDIUM = 5, LOW = 1).
- Counts of critical / high / medium / low findings.
- A short summary saved with the scan.

Because every tool ends up in the same shape, the user sees the **same result panel** everywhere, and the PDF report works for any tool.

### 4.4 History and PDF reports

Every scan is saved in the database with its raw output, normalised findings, and risk score. From the **History** page the user can:

- Re-open any past scan.
- Download a clean **PDF report** (one click) ready to send to the client.

### 4.5 Accounts and security

- Sign-up and login with **JWT** and password hashing (bcrypt).
- **Two-factor authentication** by email OTP.
- **Domain ownership verification** (DNS TXT or `.well-known` file) — a user can only scan a target after proving they own it.
- User profile, encrypted internal chat, and a `tier` field (free / pro) for future plans.

## 5. Technology Stack

- **Backend:** Python 3, FastAPI, SQLAlchemy, ReportLab, SQLite (development), MySQL (production-ready).
- **Frontend:** React 19, TypeScript, Vite, TailwindCSS, Framer Motion.
- **Security tools:** Nmap, Nikto, Nuclei, SQLMap, FFUF, Gobuster, Subfinder.
- **Blue-team stack:** Elasticsearch (ELK) for SIEM; EDR and SOAR slots ready.

## 6. Architecture (in one picture)

```
+------------------------------------------------------------+
|  Web App (React + TypeScript + Tailwind)                   |
|  - Login / 2FA   - Tools pages   - History   - SOC         |
+------------------------------+-----------------------------+
                               | REST / JSON (JWT)
+------------------------------v-----------------------------+
|  Backend API (FastAPI)                                     |
|  - Auth      - Scanners      - Reports (PDF)               |
|  - Vulnerability normaliser  - SOC / Elasticsearch client  |
+------+-------+-------+-------+-------+-------+--------+----+
       v       v       v       v       v       v        v
     nmap   nikto   nuclei  sqlmap   ffuf   gobuster  ...   +  Elasticsearch
```

## 7. Why This Project is Valuable

1. **One platform for the whole security workflow** — Red and Blue, attack and defence, in one place.
2. **Real tools, not toys** — the same software professionals use every day.
3. **A clear data model for findings** — the normaliser is a real engineering contribution and makes future analytics (deduplication, trends) easy.
4. **Educational** — students can learn by clicking, see real results, and compare tools side by side.
5. **Production quality** — JWT + 2FA, ownership verification, audit trail, PDF reporting, multi-tenant SOC.

## 8. Live Demonstration Plan

1. Sign up, enable 2FA by email, log in.
2. Verify a domain (DNS TXT challenge) so the platform allows scanning it.
3. Run **Nmap → Nikto → Nuclei** against the target. Show that the same results panel works for all three.
4. Open **History**, download the **PDF report**, and show the risk score and findings.
5. Open **/soc** and show live alerts, charts, and the client filter from Elasticsearch.
6. Open the **Traffic Analyzer** to show real network connections from the host.

## 9. Next Steps (Roadmap)

- Connect the EDR and SOAR tabs to real products (e.g. Wazuh, TheHive, Shuffle).
- Add **scheduled** and **recurring** scans.
- Deduplicate findings across tools using `(host, port, CVE)`.
- Add roles: analyst, admin, viewer.
- Move from SQLite to MySQL/PostgreSQL with proper migrations.
- Package everything in Docker (one `docker-compose up`).

## 10. Conclusion

Cyber Arena turns the project plan into a working product: a single, clean web application that covers infrastructure, SOC, pentesting, and incident response. The Red Team side and the SOC side are already running on real tools and real data; the remaining phases (full incident-response playbooks, threat intelligence, full adversary simulation) plug into the same platform without re-architecting it.
