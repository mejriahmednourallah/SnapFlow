"""Keep source HTML separate and add only text absent from the serialized DOM."""
from html import escape
import json

from bs4 import BeautifulSoup


def select_page_evidence(row):
    rendered = row.get("rendered_html")
    raw = row.get("raw_html")
    metrics = row.get("metrics") or {}
    if isinstance(metrics, str):
        try:
            metrics = json.loads(metrics)
        except (ValueError, TypeError):
            metrics = {}
    if not isinstance(metrics, dict):
        metrics = {}
    discovery = metrics.get("rendered_discovery") or {}
    discovery = discovery if isinstance(discovery, dict) else {}
    response = metrics.get("rendered_response") or {}
    response = response if isinstance(response, dict) else {}
    # Render-only insertions have no raw_html column value, but discovery may
    # contain an actual captured navigation response. Use that observation;
    # never substitute hydrated DOM for original-response evidence.
    if raw is None:
        captured_raw = response.get("raw_html") if response else discovery.get("raw_html")
        raw = captured_raw if isinstance(captured_raw, str) else (row.get("html") if not rendered else "")
    raw = raw or ""
    html = rendered or row.get("html") or raw
    captured_headers = discovery.get("response_headers") or {}
    stored_headers = metrics.get("response_headers") or {}
    headers = {}
    # The latest browser response describes the selected rendered observation.
    # Initial HTTP headers remain stored separately with the original response.
    for source in (stored_headers, captured_headers, response.get("response_headers")):
        if isinstance(source, dict):
            headers.update({str(key).lower(): value for key, value in source.items()})
    if headers:
        metrics = dict(metrics, response_headers=headers)
    shadow = response.get("shadow_dom") if response else discovery.get("shadow_dom")
    shadow = shadow if isinstance(shadow, dict) else {}
    extra = str(shadow.get("text") or "").strip()
    if not html:
        extra = str(discovery.get("visible_text") or "").strip()
    # Discovery already includes regular DOM text; appending it duplicates words.
    if extra:
        existing = BeautifulSoup(html or "", "html.parser").get_text(" ", strip=True)
        if " ".join(extra.split()) not in " ".join(existing.split()):
            section_html = f"<section data-snapflow-shadow-text='true'>{escape(extra)}</section>"
            # Keep the additional observation in the extraction copy's main
            # landmark; otherwise a long main block outranks and drops the
            # appended out-of-document section. Stored DOM/raw HTML remain intact.
            selected = BeautifulSoup(html or "", "html.parser")
            landmark = selected.find('main') or selected.select_one('[role="main"]') or selected.find('article')
            if landmark is not None:
                landmark.append(BeautifulSoup(section_html, "html.parser").section)
                html = str(selected)
            else:
                html = f"{html or ''}\n{section_html}"
    return html or "", raw, metrics
