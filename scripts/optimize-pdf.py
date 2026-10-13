"""
Writes a smaller copy of a note PDF for students on slow connections.

    python3 scripts/optimize-pdf.py <source.pdf> <dest.pdf>

Called by services/noteOptimize.service.js; the original is never modified.

Notes are mostly phone-exported pages whose diagrams are stored losslessly at
600-1100 dpi, far more detail than any screen shows even at full zoom. This is
the recipe the client signed off on after comparing zoomed ECGs side by side
(70.5 MB -> 16 MB on "Cardiology Version 1", no visible difference at 6x):

  1. Re-encode lossless images as JPEG q90 at their existing resolution.
  2. Downsample only images above 350 dpi, to 300 dpi at JPEG q85.

PyMuPDF rather than Ghostscript (scripts/compress-notes.sh) on purpose: at the
same 300 dpi target Ghostscript's output was visibly softer on ECG grid lines
and small labels.
"""

import sys

import pymupdf


def main(source_path, dest_path):
    doc = pymupdf.open(source_path)
    doc.rewrite_images(quality=90, lossy=False)
    doc.rewrite_images(dpi_threshold=350, dpi_target=300, quality=85)
    doc.save(dest_path, garbage=4, deflate=True, deflate_images=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: optimize-pdf.py <source.pdf> <dest.pdf>")
    main(sys.argv[1], sys.argv[2])
