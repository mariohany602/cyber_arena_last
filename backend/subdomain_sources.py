"""Subdomain enumeration via multiple free passive sources, fetched in parallel.

Sources (no API keys required):
  - crt.sh           Certificate Transparency log (very comprehensive)
  - HackerTarget     Free passive DNS API
  - AlienVault OTX   Passive DNS records
  - RapidDNS         HTML scrape of subdomain database
  - Wayback Machine  Archived URL listing
  - subfinder        Local CLI tool, if installed (active+passive)

Defensive measures
------------------
* Force IPv4 — some networks have broken IPv6 connectivity which hangs urllib3.
* Per-source short timeouts; sources run in parallel so the slowest one
  doesn't dominate latency.
* Each fetcher returns a set; the orchestrator merges all sets.
"""
from __future__ import annotations
import re
import socket
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterable

import requests
from bs4 import BeautifulSoup

# --- Force IPv4 globally for urllib3 (only takes effect once imported) ---
try:
    import urllib3.util.connection as _u3conn
    _u3conn.allowed_gai_family = lambda: socket.AF_INET  # IPv4 only
except Exception:
    pass


_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (CyberArena Recon) AppleWebKit/537.36",
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
})

# Per-source connect/read timeouts (seconds)
_TIMEOUT = (5, 15)
# Max time we'll spend waiting for ALL sources together
_TOTAL_BUDGET = 25


def _filter_domain(names: Iterable[str], domain: str) -> set[str]:
    domain = domain.lower().strip(".")
    out = set()
    for n in names:
        n = (n or "").strip().lower().lstrip("*.").rstrip(".")
        if not n or "*" in n:
            continue
        if n == domain or n.endswith("." + domain):
            out.add(n)
    return out


# --- individual sources ---------------------------------------------------- #

def fetch_crtsh(domain: str) -> set[str]:
    url = f"https://crt.sh/?q=%25.{domain}&output=json"
    r = _SESSION.get(url, timeout=_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    names = []
    for entry in data:
        names.extend((entry.get("name_value") or "").split("\n"))
        names.append(entry.get("common_name", ""))
    return _filter_domain(names, domain)


def fetch_hackertarget(domain: str) -> set[str]:
    url = f"https://api.hackertarget.com/hostsearch/?q={domain}"
    r = _SESSION.get(url, timeout=_TIMEOUT)
    r.raise_for_status()
    body = r.text or ""
    if "API count exceeded" in body or body.startswith("error"):
        return set()
    names = [line.split(",", 1)[0] for line in body.splitlines() if "," in line]
    return _filter_domain(names, domain)


def fetch_otx(domain: str) -> set[str]:
    url = f"https://otx.alienvault.com/api/v1/indicators/domain/{domain}/passive_dns"
    r = _SESSION.get(url, timeout=_TIMEOUT)
    r.raise_for_status()
    data = r.json() or {}
    names = [rec.get("hostname") for rec in data.get("passive_dns", []) if rec.get("hostname")]
    return _filter_domain(names, domain)


def fetch_rapiddns(domain: str) -> set[str]:
    url = f"https://rapiddns.io/subdomain/{domain}?full=1"
    r = _SESSION.get(url, timeout=_TIMEOUT)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    names = []
    for td in soup.select("td"):
        text = td.get_text(strip=True)
        if text and "." in text and " " not in text:
            names.append(text)
    return _filter_domain(names, domain)


def fetch_wayback(domain: str) -> set[str]:
    url = (
        "https://web.archive.org/cdx/search/cdx"
        f"?url=*.{domain}/*&output=json&fl=original&collapse=urlkey&limit=2000"
    )
    r = _SESSION.get(url, timeout=_TIMEOUT)
    r.raise_for_status()
    rows = r.json() or []
    names = []
    pattern = re.compile(r"https?://([^/?#:\s]+)", re.I)
    for row in rows[1:] if rows and isinstance(rows[0], list) else []:  # skip header
        if not row:
            continue
        m = pattern.match(str(row[0]))
        if m:
            names.append(m.group(1))
    return _filter_domain(names, domain)


def fetch_subfinder(domain: str) -> set[str]:
    try:
        proc = subprocess.run(
            ["subfinder", "-d", domain, "-silent"],
            capture_output=True, text=True, timeout=20,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
        return set()
    return _filter_domain((proc.stdout or "").splitlines(), domain)


SOURCES = [
    ("crt.sh",         fetch_crtsh),
    ("hackertarget",   fetch_hackertarget),
    ("otx",            fetch_otx),
    ("rapiddns",       fetch_rapiddns),
    ("wayback",        fetch_wayback),
    ("subfinder",      fetch_subfinder),
]


def discover(domain: str, total_budget: int = _TOTAL_BUDGET) -> tuple[set[str], dict[str, int], dict[str, str]]:
    """Run all sources in parallel. Returns (subdomains, per_source_counts, errors).

    Empty errors dict on success per source. Errors dict maps source name -> str.
    """
    domain = (domain or "").strip().lower()
    if not domain:
        return set(), {}, {}

    all_subs: set[str] = set()
    counts: dict[str, int] = {}
    errors: dict[str, str] = {}

    with ThreadPoolExecutor(max_workers=len(SOURCES)) as ex:
        futures = {ex.submit(fn, domain): name for name, fn in SOURCES}
        try:
            for fut in as_completed(futures, timeout=total_budget):
                name = futures[fut]
                try:
                    subs = fut.result()
                    counts[name] = len(subs)
                    all_subs |= subs
                except Exception as e:
                    counts[name] = 0
                    errors[name] = f"{type(e).__name__}: {str(e)[:120]}"
        except TimeoutError:
            for fut, name in futures.items():
                if not fut.done():
                    counts.setdefault(name, 0)
                    errors[name] = "TimeoutError: total budget exceeded"

    return all_subs, counts, errors
