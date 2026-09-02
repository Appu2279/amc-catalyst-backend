import os from 'os';
import path from 'path';
import multer from 'multer';

/**
 * Notes are uploaded to S3 exactly as received, at full quality — nothing
 * compresses them, so this is the real, final ceiling on a note's size, not a
 * pre-compression buffer. Raise it if a genuinely larger note needs to go up.
 */
const MAX_BYTES = 80 * 1024 * 1024;

/**
 * Disk, not memory. An 80MB cap with memoryStorage means one upload can pin
 * 80MB of heap on a small instance; on disk it is a temp file the OS can page
 * out.
 *
 * The controller is responsible for unlinking req.file.path — multer does not
 * clean up after itself.
 */
const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, cb) =>
    cb(null, `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname) || '.pdf'}`),
});

const upload = multer({ storage, limits: { fileSize: MAX_BYTES, files: 1 } });

/**
 * Accepts a single `file` field.
 *
 * Wrapped rather than used directly so multer's errors become the same JSON
 * shape as every other error in the API — by default they surface as Express's
 * HTML error page, which the admin UI cannot show a message from.
 *
 * The file's *content* is verified in note.service.js. Nothing here proves the
 * bytes are a PDF; mimetype is whatever the browser chose to send.
 */
export const uploadPdf = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res
        .status(413)
        .json({ message: `That file is larger than ${MAX_BYTES / 1024 / 1024}MB` });
    }

    return res.status(400).json({ message: err.message });
  });


/**
 * A single payment screenshot.
 *
 * Memory, not disk, and small: this is one phone screenshot on its way to S3,
 * so it never needs a file path and should not leave a copy of someone's
 * banking app on the server. The PDF path above is the opposite case for both
 * reasons.
 */
const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SCREENSHOT_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    // Only what a phone produces. This is the only check — unlike Cloudinary,
    // S3 stores whatever bytes it is given under whatever Content-Type it is
    // told, with no server-side validation that they are really an image. The
    // browser-supplied mimetype here is therefore trivially spoofable; the
    // stream-back in payment.controller.js sets X-Content-Type-Options: nosniff
    // and Content-Disposition: inline as a second line of defence.
    if (/^image\/(jpe?g|png|heic|heif|webp)$/i.test(file.mimetype)) return cb(null, true);
    cb(new Error('Screenshot must be a JPEG, PNG, HEIC or WebP image'));
  },
});

export const uploadScreenshot = (req, res, next) =>
  screenshotUpload.single('screenshot')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res
        .status(413)
        .json({ message: `Screenshot must be smaller than ${SCREENSHOT_MAX_BYTES / 1024 / 1024}MB` });
    }

    return res.status(400).json({ message: err.message });
  });
