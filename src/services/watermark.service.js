import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets/logo.png');

/**
 * The logo is read once and reused. Re-reading it per request would be a disk
 * hit on every note open for a file that never changes.
 *
 * A missing logo must not stop a note from being served, so a failed read
 * resolves to null and the stamp is drawn without it.
 */
let logoBytesPromise;
const loadLogoBytes = () => {
  logoBytesPromise ??= fs.readFile(LOGO_PATH).catch((err) => {
    console.error('Watermark logo could not be read:', err.message);
    return null;
  });
  return logoBytesPromise;
};

/**
 * Burns a per-viewer watermark into every page of a PDF.
 *
 * The point is traceability, not prevention. Nothing served to a browser can be
 * stopped from being saved or photographed — the bytes have to reach the client
 * to be rendered. What this does is make every copy identifiable: a screenshot
 * posted in a study group carries the email of the account that took it, which
 * is the part that actually discourages sharing.
 *
 * Three marks per page:
 *   • the AMC Catalyst logo, centred and very faint — brand presence that says
 *     where the document came from, and one more thing to remove from a
 *     screenshot
 *   • a large diagonal tile of the viewer's email, faint enough to read through
 *     but impossible to crop out of a full-page screenshot
 *   • a solid footer line, small and legible, which survives being photographed
 *     off a screen at an angle
 */

const DIAGONAL_OPACITY = 0.12;
const FOOTER_OPACITY = 0.45;
// Much fainter than the text: the logo is a large solid shape, so what reads as
// subtle for a thin glyph would sit on top of the content as a grey block.
const LOGO_OPACITY = 0.09;
// Fraction of the page's shorter side.
const LOGO_SCALE = 0.45;
// The footer mark is small, so it can be near-solid without touching
// legibility. This is the one that actually reads as branding — the centred
// logo is too faint to be seen as anything but texture, by design.
const FOOTER_LOGO_OPACITY = 0.55;

export const watermarkPdf = async (bytes, { email, noteTitle }) => {
  // Encrypted PDFs would otherwise throw. Notes are our own uploads, so this is
  // about tolerating an oddly-produced file rather than defeating protection.
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const logoBytes = await loadLogoBytes();
  let logo = null;
  if (logoBytes) {
    // Embedded once and referenced by every page — embedding per page would
    // add a full copy of the image to the file each time.
    try {
      logo = await pdf.embedPng(logoBytes);
    } catch (err) {
      console.error('Watermark logo could not be embedded:', err.message);
    }
  }
  const stamp = email || 'unknown account';
  const issued = new Date().toISOString().slice(0, 10);
  const footer = `${stamp} · ${issued} · AMC Catalyst — not for redistribution`;

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();

    // Logo first, so the email tiling sits on top of it rather than being
    // washed out by it.
    if (logo) {
      const logoWidth = Math.min(width, height) * LOGO_SCALE;
      const logoHeight = (logo.height / logo.width) * logoWidth;
      page.drawImage(logo, {
        x: (width - logoWidth) / 2,
        y: (height - logoHeight) / 2,
        width: logoWidth,
        height: logoHeight,
        opacity: LOGO_OPACITY,
      });
    }

    // Diagonal tiling. Sized from the page so it lands sensibly on A4 portrait
    // and on the odd landscape page alike.
    const diagonalSize = Math.max(14, Math.min(width, height) / 26);
    const textWidth = font.widthOfTextAtSize(stamp, diagonalSize);
    const stepY = diagonalSize * 7;
    const stepX = Math.max(textWidth + diagonalSize * 4, width / 2);

    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        page.drawText(stamp, {
          x,
          y,
          size: diagonalSize,
          font,
          color: rgb(0.45, 0.45, 0.5),
          opacity: DIAGONAL_OPACITY,
          rotate: degrees(45),
        });
      }
    }

    const footerSize = Math.max(6, Math.min(9, width / 60));
    let footerX = 12;

    // A small solid logo ahead of the footer line: legible provenance on every
    // page, and it survives a photograph of a screen far better than the faint
    // centred mark does.
    if (logo) {
      const markHeight = footerSize * 3;
      const markWidth = (logo.width / logo.height) * markHeight;
      page.drawImage(logo, {
        x: footerX,
        y: 2,
        width: markWidth,
        height: markHeight,
        opacity: FOOTER_LOGO_OPACITY,
      });
      footerX += markWidth + 5;
    }

    page.drawText(footer, {
      x: footerX,
      y: 8,
      size: footerSize,
      font,
      color: rgb(0.3, 0.3, 0.35),
      opacity: FOOTER_OPACITY,
    });
  }

  // Metadata is not a control — it is trivially stripped — but it costs nothing
  // and helps identify a file that turns up without its pages.
  pdf.setTitle(noteTitle ?? 'AMC Catalyst note');
  pdf.setSubject(`Issued to ${stamp} on ${issued}`);
  pdf.setProducer('AMC Catalyst');

  return Buffer.from(await pdf.save());
};
