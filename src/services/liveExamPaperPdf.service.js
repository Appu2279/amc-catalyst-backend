import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import upngModule from '@pdf-lib/upng';
import { LiveExam, MockTest, MockTestQuestion, Question, QuestionOption, Subject } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { EXAM_DOMAINS } from '../constants/examDomains.js';
import { getObjectBuffer, isStorageConfigured } from '../config/storage.js';

/**
 * The live exam's paper as a printable PDF for the admins: every question in
 * paper order with its figures and options, optionally with the answer and
 * explanation under each one plus an answer key at the end.
 *
 * Built with pdf-lib's standard fonts (no font files to ship), which only
 * cover Western European characters — see toPrintable for how the rest of the
 * question bank's symbols are written instead.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 50;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const BODY_SIZE = 10.5;
const LINE_GAP = 4;
const MAX_IMAGE_HEIGHT = 260;
const IMAGE_FETCH_TIMEOUT_MS = 10_000;
// Figures are shrunk to about 150 dpi at the size they are drawn: the stored
// screenshots are ~2000 px wide and made a 150-question paper 24 MB.
const MAX_IMAGE_PX = { width: 990, height: 540 };
const SHRUNK_CACHE_LIMIT = 300;

// @pdf-lib/upng is CommonJS; under ESM its API sits one `default` deeper.
const UPNG = upngModule.default ?? upngModule;

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.45, 0.48, 0.53);
const ACCENT = rgb(0.43, 0.16, 0.85);
const CORRECT = rgb(0.05, 0.5, 0.25);

const DOMAIN_LABELS = new Map(EXAM_DOMAINS.map((d) => [d.key, d.label]));

// Symbols found in the question bank that the standard fonts cannot draw.
const REPLACEMENTS = new Map(Object.entries({
  '': '•', 'μ': 'µ', '≥': '>=', '≤': '<=', '≠': '!=', '→': '->', '←': '<-', '−': '-', '◦': '-',
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'κ': 'kappa', 'λ': 'lambda',
  '⁰': '^0', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9', '⁻': '^-',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  'ā': 'a', 'ē': 'e', 'ī': 'i', 'ō': 'o', 'ū': 'u', ' ': ' ', '​': '',
  // Newer ICU puts these inside formatted times, e.g. "10:00\u202fam".
  '\u202f': ' ', '\u2009': ' ',
}));

const toPrintable = (text, charset) => {
  let out = '';
  for (const ch of String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ')) {
    if (ch === '\n' || charset.has(ch.codePointAt(0))) out += ch;
    else if (REPLACEMENTS.has(ch)) out += REPLACEMENTS.get(ch);
    else out += '?';
  }
  return out;
};

const formatInZone = (date, timeZone) => {
  const options = {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  };
  try {
    return new Date(date).toLocaleString('en-GB', { ...options, timeZone });
  } catch {
    return new Date(date).toLocaleString('en-GB', { ...options, timeZone: 'UTC' });
  }
};

// ── Images ───────────────────────────────────────────────────────────────────

const questionImageSources = (q) =>
  q.question_images?.length ? q.question_images : q.question_image ? [q.question_image] : [];

/** Raw bytes of a stored figure: our own S3 key (/api/images/question?key=…) or an https URL. */
const fetchImageBytes = async (src) => {
  if (src.startsWith('/')) {
    const key = new URL(src, 'http://local').searchParams.get('key');
    if (!key || !isStorageConfigured) return null;
    return (await getObjectBuffer(key)).buffer;
  }
  if (!/^https?:\/\//.test(src)) return null;
  const res = await fetch(src, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
};

/**
 * A PNG scaled down (area-averaged) to fit MAX_IMAGE_PX and re-encoded with a
 * 256-colour palette — about a quarter of the size, still sharp in print.
 * Returns the original when it is already small or shrinking does not help.
 */
const shrinkPng = (bytes) => {
  const img = UPNG.decode(bytes);
  const scale = Math.min(1, MAX_IMAGE_PX.width / img.width, MAX_IMAGE_PX.height / img.height);
  if (scale > 0.9) return bytes;
  const src = new Uint8Array(UPNG.toRGBA8(img)[0]);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale);
    const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale);
      const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) / scale)));
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  const shrunk = Buffer.from(UPNG.encode([out.buffer], width, height, 256));
  return shrunk.length < bytes.length ? shrunk : bytes;
};

// Shrinking is CPU work on the API process, so results are kept for the next
// download (a paper's figures do not change).
const shrunkCache = new Map();
const getPrintablePng = (src, bytes) => {
  if (shrunkCache.has(src)) return shrunkCache.get(src);
  const result = shrinkPng(bytes);
  if (shrunkCache.size >= SHRUNK_CACHE_LIMIT) shrunkCache.delete(shrunkCache.keys().next().value);
  shrunkCache.set(src, result);
  return result;
};

// Lets queued requests (students saving answers) run between figures, so a
// download never holds the event loop for more than one image's worth of work.
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

/** Embeds a figure, or returns the reason it could not be — the PDF prints that instead. */
const embedImage = async (pdf, src) => {
  try {
    const bytes = shrunkCache.get(src) ?? await fetchImageBytes(src);
    if (!bytes) return { missing: 'Figure could not be loaded' };
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      await yieldToEventLoop();
      return { image: await pdf.embedPng(getPrintablePng(src, bytes)) };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { image: await pdf.embedJpg(bytes) };
    return { missing: 'Figure is in a format PDFs cannot show — view it in the admin panel' };
  } catch (err) {
    console.warn(`Live exam PDF: figure ${src} skipped:`, err.message);
    return { missing: 'Figure could not be loaded' };
  }
};

// ── Layout ───────────────────────────────────────────────────────────────────

/** A cursor that writes top-down and starts a new page when it runs out of room. */
class Writer {
  constructor(pdf, fonts) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.charset = new Set(fonts.regular.getCharacterSet());
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN - 14; // room for the running header
  }

  ensure(height) {
    if (this.y - height < MARGIN + 20) this.newPage();
  }

  space(points) {
    this.y -= points;
  }

  wrap(text, font, size, width) {
    const lines = [];
    for (const paragraph of toPrintable(text, this.charset).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/ +/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
        if (line) lines.push(line);
        // A single word wider than the column (a long URL) is cut to fit.
        line = word;
        while (font.widthOfTextAtSize(line, size) > width) {
          let cut = line.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      lines.push(line);
    }
    return lines;
  }

  text(text, { font = this.fonts.regular, size = BODY_SIZE, color = INK, indent = 0, after = 0 } = {}) {
    const lineHeight = size + LINE_GAP;
    for (const line of this.wrap(text, font, size, CONTENT_WIDTH - indent)) {
      this.ensure(lineHeight);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color });
      this.y -= lineHeight;
    }
    this.y -= after;
  }

  /** "C." in a fixed gutter, the option text wrapped beside it. */
  option(key, text, { bold = false, color = INK } = {}) {
    const font = bold ? this.fonts.bold : this.fonts.regular;
    const gutter = 22;
    const lineHeight = BODY_SIZE + LINE_GAP;
    const lines = this.wrap(text, font, BODY_SIZE, CONTENT_WIDTH - gutter - 12);
    lines.forEach((line, i) => {
      this.ensure(lineHeight);
      if (i === 0) this.page.drawText(`${key}.`, { x: MARGIN + 12, y: this.y - BODY_SIZE, size: BODY_SIZE, font: this.fonts.bold, color });
      this.page.drawText(line, { x: MARGIN + 12 + gutter, y: this.y - BODY_SIZE, size: BODY_SIZE, font, color });
      this.y -= lineHeight;
    });
    this.y -= 2;
  }

  image(embedded) {
    if (embedded.missing) { this.text(`[${embedded.missing}]`, { color: MUTED, size: 9, after: 6 }); return; }
    const { image } = embedded;
    const scale = Math.min(1, CONTENT_WIDTH / image.width, MAX_IMAGE_HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    this.ensure(height + 8);
    this.page.drawImage(image, { x: MARGIN + (CONTENT_WIDTH - width) / 2, y: this.y - height, width, height });
    this.y -= height + 8;
  }

  rule() {
    this.ensure(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 4 }, end: { x: PAGE.width - MARGIN, y: this.y - 4 },
      thickness: 0.5, color: rgb(0.85, 0.87, 0.9),
    });
    this.y -= 12;
  }
}

const drawHeadersAndFooters = (pdf, fonts, title, withAnswers) => {
  const pages = pdf.getPages();
  const label = withAnswers ? 'CONFIDENTIAL — contains answers' : 'CONFIDENTIAL — admin copy';
  pages.forEach((page, i) => {
    if (i > 0) {
      page.drawText(title, { x: MARGIN, y: PAGE.height - MARGIN + 6, size: 8, font: fonts.regular, color: MUTED });
    }
    page.drawText(label, { x: MARGIN, y: MARGIN - 24, size: 8, font: fonts.bold, color: withAnswers ? rgb(0.75, 0.1, 0.1) : MUTED });
    const pageLabel = `Page ${i + 1} of ${pages.length}`;
    page.drawText(pageLabel, {
      x: PAGE.width - MARGIN - fonts.regular.widthOfTextAtSize(pageLabel, 8), y: MARGIN - 24, size: 8, font: fonts.regular, color: MUTED,
    });
  });
};

// ── Document ─────────────────────────────────────────────────────────────────

export const buildPaperPdf = async (examId, { withAnswers = false, timeZone = 'UTC' } = {}) => {
  const exam = await LiveExam.findByPk(examId, { include: [{ model: MockTest, as: 'mock_test' }] });
  if (!exam) throw new AppError('Live exam not found', 404);

  const paper = await MockTestQuestion.findAll({
    where: { mock_test_id: exam.mock_test_id },
    order: [['question_order', 'ASC']],
    include: [{
      model: Question, as: 'question',
      attributes: ['id', 'question_text', 'question_image', 'question_images', 'explanation'],
      include: [
        { model: QuestionOption, as: 'options', attributes: ['option_key', 'option_text', 'is_correct', 'explanation'] },
        { model: Subject, as: 'subject', attributes: ['name', 'exam_domain'] },
      ],
    }],
  });
  if (!paper.length) throw new AppError('This exam has no questions', 400);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${exam.title}${withAnswers ? ' — with answers' : ''}`);
  pdf.setAuthor('AMC Catalyst');
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  // One figure at a time: each is fetched, shrunk and embedded before the next,
  // which keeps memory flat and lets other requests run in between.
  const figures = [];
  for (const mq of paper) {
    const embedded = [];
    for (const src of questionImageSources(mq.question)) embedded.push(await embedImage(pdf, src));
    figures.push(embedded);
  }

  const w = new Writer(pdf, fonts);
  const mock = exam.mock_test;

  // Cover
  w.text('AMC CATALYST · LIVE EXAM', { font: fonts.bold, size: 9, color: ACCENT, after: 6 });
  w.text(exam.title, { font: fonts.bold, size: 20, after: 10 });
  w.text(`${mock.total_questions} questions · ${mock.total_marks} marks · ${mock.duration_minutes} minutes`, { after: 4 });
  w.text(`Opens:  ${formatInZone(exam.opens_at, timeZone)}`, { color: MUTED });
  w.text(`Closes: ${formatInZone(exam.closes_at, timeZone)}`, { color: MUTED, after: 4 });
  w.text(`Generated ${formatInZone(new Date(), timeZone)}`, { color: MUTED, size: 9, after: 4 });
  if (mock.randomize_questions) {
    w.text('Questions are shuffled for each student; this copy shows them in paper order.', { color: MUTED, size: 9 });
  }
  w.text(withAnswers
    ? 'This copy contains the correct answers. Do not share it with students.'
    : 'Question paper without answers. Do not share it with students before the exam.', { font: fonts.bold, size: 9, color: rgb(0.75, 0.1, 0.1) });
  w.rule();

  paper.forEach((mq, index) => {
    const q = mq.question;
    const options = [...q.options].sort((a, b) => String(a.option_key).localeCompare(String(b.option_key)));
    const correct = options.find((o) => o.is_correct);
    const tags = [DOMAIN_LABELS.get(q.subject?.exam_domain), q.subject?.name].filter(Boolean).join(' · ');

    w.ensure(60); // keep a question's heading with its first lines
    w.text(`Question ${index + 1}`, { font: fonts.bold, size: 11, color: ACCENT });
    if (tags) w.text(tags, { size: 8, color: MUTED, after: 2 });
    w.space(2);
    w.text(q.question_text, { after: 6 });
    figures[index].forEach((figure) => w.image(figure));

    for (const o of options) {
      const highlight = withAnswers && o.is_correct;
      w.option(o.option_key, o.option_text, { bold: highlight, color: highlight ? CORRECT : INK });
    }

    if (withAnswers) {
      w.space(2);
      w.text(correct ? `Answer: ${correct.option_key}` : 'Answer: not set', { font: fonts.bold, color: correct ? CORRECT : rgb(0.75, 0.1, 0.1) });
      const explanation = q.explanation || correct?.explanation;
      if (explanation) w.text(explanation, { size: 9.5, color: MUTED });
    }
    w.rule();
  });

  if (withAnswers) {
    w.newPage();
    w.text('Answer key', { font: fonts.bold, size: 16, after: 8 });
    const columns = 6;
    const columnWidth = CONTENT_WIDTH / columns;
    const rowHeight = 16;
    paper.forEach((mq, index) => {
      const correct = mq.question.options.find((o) => o.is_correct);
      const column = index % columns;
      if (column === 0) w.ensure(rowHeight);
      w.page.drawText(`${index + 1}.  ${correct?.option_key ?? '—'}`, {
        x: MARGIN + column * columnWidth, y: w.y - BODY_SIZE, size: BODY_SIZE, font: fonts.regular, color: INK,
      });
      if (column === columns - 1 || index === paper.length - 1) w.space(rowHeight);
    });
  }

  drawHeadersAndFooters(pdf, fonts, toPrintable(exam.title, w.charset), withAnswers);

  const safeName = exam.slug || `live-exam-${exam.id}`;
  return {
    filename: `${safeName}-paper${withAnswers ? '-with-answers' : ''}.pdf`,
    bytes: await pdf.save(),
  };
};
