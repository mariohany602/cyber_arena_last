"""PDF report generator for persisted Scan rows.

Layout:
  Cover  — branding header, target, tool, date, operator
  Executive Summary — risk score, severity counts, label
  Findings — one block per finding, severity-colored
"""
from __future__ import annotations
import io
import json
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER

from vuln_assessment import SEVERITIES, tool_label, risk_label

SEVERITY_COLOR = {
    "CRITICAL": colors.HexColor("#7f1d1d"),
    "HIGH":     colors.HexColor("#dc2626"),
    "MEDIUM":   colors.HexColor("#d97706"),
    "LOW":      colors.HexColor("#2563eb"),
    "INFO":     colors.HexColor("#475569"),
}
ACCENT = colors.HexColor("#0ea5e9")
MUTED = colors.HexColor("#64748b")


def _styles():
    ss = getSampleStyleSheet()
    return {
        "title":    ParagraphStyle("title", parent=ss["Title"], fontSize=24, leading=28,
                                   textColor=colors.HexColor("#0f172a")),
        "h2":       ParagraphStyle("h2", parent=ss["Heading2"], fontSize=14, leading=18,
                                   textColor=ACCENT, spaceBefore=10, spaceAfter=6),
        "body":     ParagraphStyle("body", parent=ss["BodyText"], fontSize=10, leading=14,
                                   textColor=colors.HexColor("#0f172a")),
        "muted":    ParagraphStyle("muted", parent=ss["BodyText"], fontSize=9, leading=12,
                                   textColor=MUTED),
        "fhead":    ParagraphStyle("fhead", parent=ss["Heading4"], fontSize=11, leading=14,
                                   textColor=colors.HexColor("#0f172a"), spaceAfter=2),
        "code":     ParagraphStyle("code", parent=ss["BodyText"], fontSize=8.5, leading=11,
                                   fontName="Courier", textColor=colors.HexColor("#1e293b"),
                                   backColor=colors.HexColor("#f1f5f9"),
                                   borderPadding=4, leftIndent=4, rightIndent=4),
    }


def _cover(scan, user, st):
    flow = []
    flow.append(Paragraph("CYBER ARENA", st["muted"]))
    flow.append(Paragraph("Security Assessment Report", st["title"]))
    flow.append(Spacer(1, 6 * mm))

    meta = [
        ["Tool",      tool_label(scan.tool)],
        ["Target",    scan.target],
        ["Engine",    scan.engine or "—"],
        ["Operator",  f"{user.username}  <{user.email}>"],
        ["Scan ID",   f"#{scan.id}"],
        ["Generated", datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")],
        ["Started",   scan.created_at.strftime("%Y-%m-%d %H:%M UTC") if scan.created_at else "—"],
    ]
    t = Table(meta, colWidths=[35 * mm, 130 * mm])
    t.setStyle(TableStyle([
        ("FONT",       (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT",       (0, 0), (0, -1),  "Helvetica-Bold", 10),
        ("TEXTCOLOR",  (0, 0), (0, -1),  MUTED),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW",  (0, 0), (-1, -2),  0.25, colors.HexColor("#e2e8f0")),
    ]))
    flow.append(t)
    return flow


def _summary(counts, score, st):
    flow = [Paragraph("Executive Summary", st["h2"])]
    label = risk_label(score)
    flow.append(Paragraph(
        f"Overall Risk Score: <b>{score:.1f} / 100</b> &nbsp; "
        f"&nbsp; Risk Level: <font color='{SEVERITY_COLOR[label].hexval()}'><b>{label}</b></font>",
        st["body"],
    ))
    flow.append(Spacer(1, 4 * mm))

    header = ["Severity"] + SEVERITIES
    row    = ["Findings"] + [str(counts.get(s, 0)) for s in SEVERITIES]
    sev_table = Table([header, row], colWidths=[28 * mm] + [27 * mm] * len(SEVERITIES))

    style = TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica-Bold", 10),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
    ])
    for i, sev in enumerate(SEVERITIES, start=1):
        style.add("BACKGROUND", (i, 0), (i, 0), SEVERITY_COLOR[sev])
        style.add("TEXTCOLOR",  (i, 0), (i, 0), colors.white)
    sev_table.setStyle(style)
    flow.append(sev_table)
    return flow


def _findings(findings, st):
    flow = [PageBreak(), Paragraph("Findings", st["h2"])]
    if not findings:
        flow.append(Paragraph("No findings recorded for this scan.", st["muted"]))
        return flow

    # Sort: critical first, then high, etc.
    order = {s: i for i, s in enumerate(SEVERITIES)}
    findings_sorted = sorted(findings, key=lambda f: order.get(str(f.get("severity", "INFO")).upper(), 99))

    for i, f in enumerate(findings_sorted, start=1):
        sev = str(f.get("severity", "INFO")).upper()
        color = SEVERITY_COLOR.get(sev, MUTED)
        title = f.get("title", "Finding")
        loc = f.get("location") or ""
        desc = (f.get("description") or "").strip()
        evidence = (f.get("evidence") or "").strip()

        block = []
        # Severity badge + title
        badge = Table(
            [[Paragraph(f"<b>{sev}</b>", ParagraphStyle("b", fontName="Helvetica-Bold",
                                                       fontSize=9, textColor=colors.white,
                                                       alignment=TA_CENTER)),
              Paragraph(f"<b>{i}. {title}</b>", st["fhead"])]],
            colWidths=[22 * mm, 145 * mm],
        )
        badge.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), color),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (0, 0), 4),
            ("RIGHTPADDING", (0, 0), (0, 0), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (1, 0), (1, 0), 6),
        ]))
        block.append(badge)
        if loc:
            block.append(Paragraph(f"<b>Location:</b> {loc}", st["muted"]))
        if desc:
            block.append(Paragraph(desc.replace("\n", "<br/>"), st["body"]))
        if evidence:
            ev = evidence[:1200].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            block.append(Paragraph(f"<b>Evidence:</b><br/>{ev}", st["code"]))
        block.append(Spacer(1, 3 * mm))
        flow.append(KeepTogether(block))

    return flow


def render_scan_pdf(scan, user) -> bytes:
    """Build a PDF for a Scan row + its owner. Returns raw bytes."""
    findings = json.loads(scan.findings_json or "[]")
    counts = json.loads(scan.severity_counts_json or "{}")
    score = float(scan.risk_score or 0)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"Cyber Arena Report - {scan.tool} - {scan.target}",
        author="Cyber Arena",
    )
    st = _styles()
    story = []
    story.extend(_cover(scan, user, st))
    story.append(Spacer(1, 6 * mm))
    story.extend(_summary(counts, score, st))
    story.extend(_findings(findings, st))

    def _footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 10 * mm, "Cyber Arena — Confidential")
        canvas.drawRightString(190 * mm, 10 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
