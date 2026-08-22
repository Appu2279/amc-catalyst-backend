import os from 'os';
import path from 'path';
import multer from 'multer';

/**
 * Well above Cloudinary's 10 MiB ceiling on purpose: the server compresses
 * oversized PDFs before uploading them (see compressPdf in
 * services/compress.service.js), so what matters here is the size we are
 * willing to receive, not the size storage will accept.
 */
const MAX_BYTES = 80 * 1024 * 1024;

/**
 * Disk, not memory. Two reasons:
 *   • Ghostscript needs a real file path anyway, so a memory buffer would only
 *     be written to disk a moment later.
 *   • An 80MB cap with memoryStorage means one upload can pin 80MB of heap on
 *     a small instance. On disk it is a temp file the OS can page out.
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
