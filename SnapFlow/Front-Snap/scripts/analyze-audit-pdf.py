#!/usr/bin/env python3
"""Analyze SnapFlow audit PDFs for sparse pages and small text.

The script is intentionally report-agnostic: it detects page type from text
content, not page numbers, then flags weak content pages with configurable
thresholds.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def import_dependencies():
    try:
        import fitz  # type: ignore
        from PIL import Image, ImageDraw  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime helper
        raise SystemExit(
            "Missing dependency. Install PyMuPDF and Pillow first: "
            "python -m pip install pymupdf pillow"
        ) from exc
    return fitz, Image, ImageDraw


VOLUNTARY_SPARSE_TYPES = {"cover", "toc", "conclusion", "back_cover"}


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def detect_page_type(lines: list[str], page_number: int, page_count: int) -> str:
    joined = normalize_text(" ".join(lines[:8]))
    first = normalize_text(lines[0] if lines else "")

    if page_number == 1 or "audit de maintenance preventive" in joined:
        return "cover"
    if "table des matieres" in joined or "structure du rapport" in joined:
        return "toc"
    if "resume executif" in joined or "vue globale" in joined:
        return "executive_summary"
    if "grille des controles" in joined or "tableau de score par axe" in joined:
        return "kpi_grid"
    if "plan d'action" in joined or "tableau synthetique" in joined:
        return "recommendations"
    if "priorites d'action" in joined or "planification par horizon" in joined:
        return "roadmap"
    if "conclusion" in first or "synthese finale" in joined:
        return "conclusion"
    if page_number == page_count and "merci" in joined:
        return "back_cover"
    if "annexes" in joined or "preuves" in joined:
        return "annexe"
    if "analyse detaillee par axe" in joined:
        return "axis"
    return "content"


def page_text_stats(page: Any) -> dict[str, Any]:
    text = page.get_text("text").strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    words = page.get_text("words")
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                value = span.get("text", "").strip()
                if value:
                    spans.append(span)
    return {"text": text, "lines": lines, "words": words, "spans": spans}


def content_bbox(spans: list[dict[str, Any]], footer_cutoff: float) -> tuple[float, float, float, float] | None:
    boxes = []
    for span in spans:
        text = normalize_text(span.get("text", ""))
        if not text:
            continue
        if span["bbox"][1] > footer_cutoff:
            continue
        if "rapport confidentiel" in text or "medianet x snapflow" in text:
            continue
        boxes.append(span["bbox"])
    if not boxes:
        return None
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def make_contact_sheets(image_paths: list[Path], out_dir: Path, cols: int, rows_per_sheet: int) -> list[str]:
    if not image_paths:
        return []
    _, Image, ImageDraw = import_dependencies()
    images = [Image.open(path).convert("RGB") for path in image_paths]
    thumb_w, thumb_h = images[0].size
    contact_paths: list[str] = []
    per_sheet = cols * rows_per_sheet
    for sheet_index, start in enumerate(range(0, len(images), per_sheet), 1):
        subset = images[start : start + per_sheet]
        rows = math.ceil(len(subset) / cols)
        sheet = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + 22)), "white")
        draw = ImageDraw.Draw(sheet)
        for idx, image in enumerate(subset):
            x = (idx % cols) * thumb_w
            y = (idx // cols) * (thumb_h + 22)
            sheet.paste(image, (x, y + 22))
            draw.text((x + 4, y + 4), f"p{start + idx + 1}", fill=(0, 0, 0))
        path = out_dir / f"contact_{sheet_index:02d}.png"
        sheet.save(path)
        contact_paths.append(str(path))
    return contact_paths


def analyze_pdf(args: argparse.Namespace) -> dict[str, Any]:
    fitz, _, _ = import_dependencies()
    pdf_path = Path(args.pdf).resolve()
    if not pdf_path.exists():
        raise SystemExit(f"PDF not found: {pdf_path}")

    out_dir = Path(args.out).resolve() if args.out else pdf_path.with_suffix("").with_name(f"{pdf_path.stem}_analysis")
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    page_count = len(doc)
    page_infos: list[dict[str, Any]] = []
    image_paths: list[Path] = []
    small_spans = 0
    total_spans = 0
    font_counter: Counter[float] = Counter()

    for index, page in enumerate(doc):
        stats = page_text_stats(page)
        page_number = index + 1
        page_type = detect_page_type(stats["lines"], page_number, page_count)
        footer_cutoff = page.rect.height - 52
        bbox = content_bbox(stats["spans"], footer_cutoff)
        bottom_blank = page.rect.height if bbox is None else max(0, footer_cutoff - bbox[3])

        for span in stats["spans"]:
            size = round(float(span.get("size", 0)), 1)
            total_spans += 1
            font_counter[size] += 1
            if size < args.min_font_size:
                small_spans += 1

        pix = page.get_pixmap(matrix=fitz.Matrix(args.scale, args.scale), alpha=False)
        image_path = out_dir / f"page_{page_number:03d}.png"
        pix.save(image_path)
        image_paths.append(image_path)

        weak_reasons = []
        if page_type not in VOLUNTARY_SPARSE_TYPES:
            if len(stats["words"]) < args.min_content_words:
                weak_reasons.append("low_word_count")
            if bottom_blank > args.max_bottom_whitespace:
                weak_reasons.append("large_bottom_whitespace")

        page_infos.append(
            {
                "page": page_number,
                "type": page_type,
                "words": len(stats["words"]),
                "chars": len(stats["text"]),
                "bottom_blank": round(bottom_blank, 1),
                "weak_reasons": weak_reasons,
                "preview": " | ".join(stats["lines"][:5])[:180],
                "screenshot": str(image_path),
            }
        )

    contact_sheets = make_contact_sheets(image_paths, out_dir, args.contact_cols, args.contact_rows)
    weak_pages = [info for info in page_infos if info["weak_reasons"]]
    summary = {
        "pdf": str(pdf_path),
        "pages": page_count,
        "weak_pages": weak_pages,
        "weak_page_numbers": [info["page"] for info in weak_pages],
        "small_font_ratio_pct": round((small_spans / total_spans * 100) if total_spans else 0, 1),
        "small_spans": small_spans,
        "total_text_spans": total_spans,
        "font_size_counts": font_counter.most_common(20),
        "screenshots_dir": str(out_dir),
        "contact_sheets": contact_sheets,
        "thresholds": {
            "min_content_words": args.min_content_words,
            "max_bottom_whitespace": args.max_bottom_whitespace,
            "min_font_size": args.min_font_size,
        },
        "pages_detail": page_infos,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze a SnapFlow audit PDF for sparse pages.")
    parser.add_argument("pdf", help="Path to the PDF to analyze.")
    parser.add_argument("--out", help="Output directory for screenshots and summary JSON.")
    parser.add_argument("--min-content-words", type=int, default=70)
    parser.add_argument("--max-bottom-whitespace", type=float, default=390)
    parser.add_argument("--min-font-size", type=float, default=8.5)
    parser.add_argument("--scale", type=float, default=0.45)
    parser.add_argument("--contact-cols", type=int, default=4)
    parser.add_argument("--contact-rows", type=int, default=5)
    args = parser.parse_args()

    summary = analyze_pdf(args)
    printable = {
        "pages": summary["pages"],
        "weak_page_numbers": summary["weak_page_numbers"],
        "small_font_ratio_pct": summary["small_font_ratio_pct"],
        "screenshots_dir": summary["screenshots_dir"],
        "contact_sheets": summary["contact_sheets"],
    }
    print(json.dumps(printable, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
