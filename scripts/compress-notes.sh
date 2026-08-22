#!/usr/bin/env bash
#
# Shrink note PDFs to fit the 10 MiB storage limit.
#
#   ./scripts/compress-notes.sh ./notes/*.pdf
#   ./scripts/compress-notes.sh --quality screen ./notes/big.pdf
#
# Writes into a compressed/ subdirectory using the SAME filename, and never
# modifies the original, so a bad result costs nothing. The filename is
# preserved deliberately: the upload derives both the note title and its storage
# id from it, so a "-compressed" suffix would title the note "... Compressed"
# and register it as a second note rather than replacing the original.
#
# Reports before/after and flags anything still over the limit.
#
# Quality presets (Ghostscript -dPDFSETTINGS):
#   ebook   150 dpi images — the default here, fine for reading on screen
#   screen   72 dpi images — much smaller, visibly softer
#   printer 300 dpi images — near-original, shrinks least
#
# Requires Ghostscript:  brew install ghostscript
set -uo pipefail

LIMIT=$((10 * 1024 * 1024))
QUALITY="ebook"

if [[ "${1:-}" == "--quality" ]]; then
  QUALITY="$2"
  shift 2
fi

if ! command -v gs >/dev/null 2>&1; then
  echo "Ghostscript is not installed. Run: brew install ghostscript" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "usage: $0 [--quality screen|ebook|printer] <file.pdf> [more.pdf ...]" >&2
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

  gs -sDEVICE=pdfwrite \
     -dCompatibilityLevel=1.4 \
     -dPDFSETTINGS="/$QUALITY" \
     -dNOPAUSE -dQUIET -dBATCH \
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

  printf '%-8s %s — %s -> %s (-%s%%) %s\n' \
    "done" "$(basename "$src")" "$(human "$before")" "$(human "$after")" "$pct" "$status"
done

if (( over_limit )); then
  echo
  echo "Some files are still over $(human "$LIMIT"). Try --quality screen, or split the"
  echo "PDF into parts and upload them as separate notes."
  exit 1
fi
