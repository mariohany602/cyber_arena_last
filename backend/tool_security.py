"""Centralized validation for pentest tool inputs.

The goals:
  * Prevent SSRF / scans of the platform itself or other internal hosts
    unless the caller explicitly opts in (e.g. localhost lab targets).
  * Reject shell-metacharacter / argument-injection style payloads on
    fields that get spliced into subprocess command lines (nmap script
    names, sqlmap dbms, etc.) BEFORE they reach the binary.
  * Provide a single place to grow into asset-bound authorization later.

Nothing here actually *runs* a tool — it just raises HTTPException(400)
on bad input so every endpoint can call it uniformly at the top.
"""
from __future__ import annotations

import ipaddress
import os
import re
import socket
from urllib.parse import urlparse

from fastapi import HTTPException

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
# When CYBER_ARENA_ALLOW_INTERNAL=1 the validator allows scans of loopback /
# RFC1918 / link-local targets. Useful for lab/DVWA/juice-shop demos.
ALLOW_INTERNAL = os.environ.get("CYBER_ARENA_ALLOW_INTERNAL", "1") == "1"

# Hostnames we never want to scan, even with ALLOW_INTERNAL=1, because they
# point back at the platform itself (the backend port, the frontend dev
# server, the cloud metadata service, etc.).
BLOCKED_EXACT = {
    "169.254.169.254",   # AWS / GCP metadata
    "metadata.google.internal",
    "metadata.azure.com",
    "fd00:ec2::254",     # AWS IMDS v6
}

# Allowed schemes for URL-style targets.
ALLOWED_SCHEMES = ("http", "https")

# Hostname pattern: labels of [A-Za-z0-9-], 1-63 chars, dot-separated.
# Also accepts IPv4 / IPv6 literals (bracketed for IPv6 in URLs).
_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)(?:[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)"
    r"(?:\.[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)*\.?$"
)

# Pattern used to validate "safe argument" fields (nmap script names, sqlmap
# --dbms, ffuf method, etc.). Lets through letters, digits, dot, dash,
# underscore, comma, slash, plus.
SAFE_ARG_RE = re.compile(r"^[A-Za-z0-9._,\-/+]{1,128}$")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _bad(msg: str) -> "HTTPException":
    return HTTPException(status_code=400, detail=f"Invalid target: {msg}")


def _ip_is_internal(ip: ipaddress._BaseAddress) -> bool:
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _resolve_all(host: str) -> list[ipaddress._BaseAddress]:
    """Resolve a hostname to every A/AAAA record it advertises.

    Defenders against DNS rebinding should ideally pin the resolved IP and
    pass it to the tool, but most binaries here re-resolve internally — so
    we conservatively reject if *any* answer is internal.
    """
    out: list[ipaddress._BaseAddress] = []
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise _bad(f"DNS resolution failed for {host!r}: {e}")
    for fam, _, _, _, sockaddr in infos:
        try:
            ip = ipaddress.ip_address(sockaddr[0])
        except ValueError:
            continue
        out.append(ip)
    return out


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def validate_host(target: str, *, allow_internal: bool | None = None) -> str:
    """Validate a bare host (IP or DNS name). Returns the canonical lowercased host.

    Used by tools that take a host (not a URL): nmap, subdomains.
    """
    if not target or not isinstance(target, str):
        raise _bad("target is required")
    host = target.strip().lower()
    # Strip any accidentally-included scheme/path so users can paste URLs.
    if "://" in host:
        host = urlparse(host).hostname or ""
    if not host:
        raise _bad("empty host")
    if "/" in host or " " in host or "\x00" in host:
        raise _bad("host contains illegal characters")
    # Bracketed IPv6 like [::1]
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    if host in BLOCKED_EXACT:
        raise _bad(f"host {host} is blocked")

    # Try literal-IP first
    try:
        ip = ipaddress.ip_address(host)
        ips = [ip]
    except ValueError:
        if not _HOSTNAME_RE.match(host):
            raise _bad("not a valid hostname or IP")
        ips = _resolve_all(host)
        if not ips:
            raise _bad("hostname did not resolve")

    permit_internal = ALLOW_INTERNAL if allow_internal is None else allow_internal
    if not permit_internal:
        for ip in ips:
            if _ip_is_internal(ip):
                raise _bad(f"host {host} resolves to a non-public address ({ip})")

    return host


def validate_url(url: str, *, allow_internal: bool | None = None,
                 require_fuzz: bool = False) -> str:
    """Validate a URL-style target. Returns the (possibly normalized) URL.

    - Accepts bare hosts (no scheme) and prefixes http://.
    - Blocks file://, gopher://, internal-only schemes.
    - Resolves the hostname and applies the same internal-IP policy as
      validate_host().
    """
    if not url or not isinstance(url, str):
        raise _bad("url is required")
    raw = url.strip()
    if "://" not in raw:
        raw = "http://" + raw
    parsed = urlparse(raw)
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise _bad(f"unsupported URL scheme {parsed.scheme!r}")
    if not parsed.hostname:
        raise _bad("URL has no hostname")
    # Re-use host validation (this also enforces the internal policy).
    validate_host(parsed.hostname, allow_internal=allow_internal)
    if require_fuzz and "FUZZ" not in raw:
        raise _bad("URL must contain the FUZZ keyword")
    return raw


def safe_arg(value: str, field_name: str = "argument", *,
             allowed: set[str] | None = None) -> str:
    """Validate a free-text field that will be embedded in a subprocess call.

    If `allowed` is given, only those exact values pass.
    Otherwise the value must match SAFE_ARG_RE.
    """
    if value is None:
        return ""
    v = str(value).strip()
    if not v:
        return ""
    if allowed is not None:
        if v not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid {field_name}: must be one of {sorted(allowed)}",
            )
        return v
    if not SAFE_ARG_RE.match(v):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: only letters, digits and ._,-/+ allowed",
        )
    return v
