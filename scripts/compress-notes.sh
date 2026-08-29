#!/usr/bin/env bash
#
# Shrink note PDFs to fit the 10 MiB storage limit.
#
#   ./scripts/compress-notes.sh ./notes/*.pdf
#   ./scripts/compress-notes.sh --dpi 220 ./notes/big.pdf
#
# Writes into a compressed/ subdirectory using the SAME filename, and never
# modifies the original, so a bad result costs nothing. The filename is
# preserved deliberately: the upload derives both the note title and its storage
# id from it, so a "-compressed" suffix would title the note "... Compressed"
# and register it as a second note rather than replacing the original.
#
# Reports before/after and flags anything still over the limit.
#
# --dpi is the resolution images are downsampled to, and mirrors the ladder in
# services/compress.service.js:
#   300  the default — keeps small print inside figures and tables readable
#   220  a middle rung for a file that will not fit at 300
#   150  the floor; below this the text inside a figure stops being readable,
#        so split the PDF into parts instead of going lower
#
# Requires Ghostscript:  brew install ghostscript
set -uo pipefail

LIMIT=$((10 * 1024 * 1024))
DPI=300

if [[ "${1:-}" == "--dpi" ]]; then
  DPI="$2"
  shift 2
fi

if ! command -v gs >/dev/null 2>&1; then
  echo "Ghostscript is not installed. Run: brew install ghostscript" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "usage: $0 [--dpi 300|220|150] <file.pdf> [more.pdf ...]" >&2
  exit 1
fi

# Portable file size: stat's flags differ between macOS and Linux, and this
# script gets run on both a laptop and the server.
size_of() { wc -c < "$1" | tr -d ' '; }

human() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b/1048576 }'; }

over_limit=0

for src in "$@"; do
  if [[ ! -f "$src" ]]; then
    echo "skip     $src (not found)"
    continue
  fi

  outdir="$(dirname "$src")/compressed"
  mkdir -p "$outdir"
  dest="$outdir/$(basename "$src")"
  before=$(size_of "$src")

  # Kept in step with gsArgs() in services/compress.service.js — see the comment
  # there for why every knob is set explicitly instead of using -dPDFSETTINGS.
  gs -sDEVICE=pdfwrite \
     -dCompatibilityLevel=1.5 \
     -dNOPAUSE -dQUIET -dBATCH -dSAFER \
     -dColorConversionStrategy=/sRGB \
     -dDownsampleColorImages=true \
     -dColorImageDownsampleType=/Bicubic \
     -dColorImageResolution="$DPI" \
     -dColorImageDownsampleThreshold=1.0 \
     -dDownsampleGrayImages=true \
     -dGrayImageDownsampleType=/Bicubic \
     -dGrayImageResolution="$DPI" \
     -dGrayImageDownsampleThreshold=1.0 \
     -dAutoFilterColorImages=false \
     -dColorImageFilter=/DCTEncode \
     -dAutoFilterGrayImages=false \
     -dGrayImageFilter=/DCTEncode \
     -dJPEGQ=90 \
     -sOutputFile="$dest" "$src" 2>/dev/null

  if [[ ! -s "$dest" ]]; then
    echo "FAILED   $(basename "$src") — Ghostscript produced nothing"
    rm -f "$dest"
    over_limit=1
    continue
  fi

  after=$(size_of "$dest")

  # Compressing an already-optimised PDF can make it bigger. Keeping the larger
  # output would be actively unhelpful, so drop it and say so.
  if (( after >= before )); then
    # No gain: copy the original across so compressed/ holds a complete set and
    # can be uploaded with a single glob.
    cp "$src" "$dest"
    echo "kept     $(basename "$src") — $(human "$before"), compression gained nothing"
    (( before > LIMIT )) && over_limit=1
    continue
  fi

  pct=$(awk -v a="$before" -v b="$after" 'BEGIN { printf "%d", (1 - b/a) * 100 }')
  status="ok"
  if (( after > LIMIT )); then
    status="STILL OVER $(human "$LIMIT")"
    over_limit=1
  fi

  printf '%-8s %s — %s -> %s (-%s%%) @ %s dpi %s\n' \
    "done" "$(basename "$src")" "$(human "$before")" "$(human "$after")" "$pct" "$DPI" "$status"
done

if (( over_limit )); then
  echo
  echo "Some files are still over $(human "$LIMIT"). Try --dpi 220, then --dpi 150."
  echo "Below 150 dpi the text inside figures stops being readable — split the PDF"
  echo "into parts and upload them as separate notes instead."
  exit 1
fi
