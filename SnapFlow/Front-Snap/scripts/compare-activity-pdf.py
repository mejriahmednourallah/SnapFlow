#!/usr/bin/env python3
"""Render and compare two activity PDFs page by page.

Example:
  python scripts/compare-activity-pdf.py \
    --baseline "%USERPROFILE%/Downloads/2026_Activite_Fatales.pdf" \
    --candidate "%USERPROFILE%/Downloads/rapport-activite-fatales-2026-06-29.pdf"
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def import_dependencies():
    try:
        import fitz  # type: ignore
        import numpy as np  # type: ignore
        from PIL import Image, ImageDraw  # type: ignore
        from skimage.metrics import structural_similarity as ssim  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime helper
        raise SystemExit(
            "Missing dependency. Install PyMuPDF, Pillow, numpy and scikit-image first: "
            "python -m pip install pymupdf pillow numpy scikit-image"
        ) from exc
    return fitz, np, Image, ImageDraw, ssim


def render_pdf(pdf_path: Path, out_dir: Path, prefix: str, zoom: float) -> list[Path]:
    fitz, _, Image, ImageDraw, _ = import_dependencies()
    doc = fitz.open(str(pdf_path))
    paths: list[Path] = []
    for index in range(doc.page_count):
        pix = doc.load_page(index).get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        draw = ImageDraw.Draw(image)
        label = f"{prefix} p{index + 1}"
        draw.rectangle([0, 0, 120, 28], fill=(255, 255, 255), outline=(0, 0, 0))
        draw.text((7, 7), label, fill=(0, 0, 0))
        page_path = out_dir / f"{prefix}_p{index + 1:02d}.png"
        image.save(page_path)
        paths.append(page_path)
    doc.close()
    return paths


def make_contact_sheet(paths: list[Path], out_path: Path, cols: int = 4) -> None:
    _, _, Image, _, _ = import_dependencies()
    if not paths:
        return
    images = [Image.open(path).convert("RGB") for path in paths]
    width = max(image.width for image in images)
    height = max(image.height for image in images)
    rows = math.ceil(len(images) / cols)
    sheet = Image.new("RGB", (cols * width, rows * height), "white")
    for index, image in enumerate(images):
        sheet.paste(image, ((index % cols) * width, (index // cols) * height))
    sheet.save(out_path)


def compare_pages(baseline: list[Path], candidate: list[Path]) -> list[dict[str, Any]]:
    _, np, Image, _, ssim = import_dependencies()
    results: list[dict[str, Any]] = []
    for index in range(max(len(baseline), len(candidate))):
        if index >= len(baseline) or index >= len(candidate):
            results.append({"page": index + 1, "status": "missing_page"})
            continue
        base = Image.open(baseline[index]).convert("RGB")
        cand = Image.open(candidate[index]).convert("RGB")
        if base.size != cand.size:
            cand = cand.resize(base.size)
        score = ssim(np.array(base), np.array(cand), channel_axis=2, data_range=255)
        results.append({
            "page": index + 1,
            "status": "compared",
            "ssim": round(float(score), 4),
            "diff_pct": round((1 - float(score)) * 100, 2),
        })
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--out-dir", type=Path, default=Path("tmp/activity-pdf-compare"))
    parser.add_argument("--zoom", type=float, default=0.25)
    args = parser.parse_args()

    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    baseline_pages = render_pdf(args.baseline, out_dir, "baseline", args.zoom)
    candidate_pages = render_pdf(args.candidate, out_dir, "candidate", args.zoom)
    make_contact_sheet(baseline_pages, out_dir / "baseline_contact.png")
    make_contact_sheet(candidate_pages, out_dir / "candidate_contact.png")
    results = {
        "baseline": str(args.baseline),
        "candidate": str(args.candidate),
        "baseline_pages": len(baseline_pages),
        "candidate_pages": len(candidate_pages),
        "pages": compare_pages(baseline_pages, candidate_pages),
    }
    (out_dir / "comparison.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
