import * as PaymentService from '../services/payment.service.js';
import { getObjectBuffer, isStorageConfigured } from '../config/storage.js';
import { AppError } from '../utils/AppError.js';

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// ── User ──────────────────────────────────────────────────────────────────────

export const startClaim = async (req, res) => {
  try {
    const claim = await PaymentService.startClaim(req.user.id, req.body.course_id);
    res.status(201).json(claim);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const submitClaim = handle((req) =>
  PaymentService.submitClaim(req.user.id, req.params.id, {
    utr: req.body.utr,
    amount_claimed: req.body.amount_claimed,
    // multer memoryStorage, so this is the bytes themselves — see
    // uploadScreenshot in middleware/uploadMiddleware.js.
    screenshot: req.file?.buffer,
    screenshotContentType: req.file?.mimetype,
  })
);

export const listMyClaims = handle((req) => PaymentService.listMyClaims(req.user.id));

// ── Admin ─────────────────────────────────────────────────────────────────────

export const listClaims = handle((req) =>
  PaymentService.listClaims({
    status: req.query.status,
    include_unsubmitted: req.query.include_unsubmitted === 'true',
  })
);

export const getClaim = handle((req) => PaymentService.getClaim(req.params.id));

export const approveClaim = handle((req) =>
  PaymentService.approveClaim(req.params.id, req.user.id, { note: req.body.note })
);

export const rejectClaim = handle((req) =>
  PaymentService.rejectClaim(req.params.id, req.user.id, { note: req.body.note })
);

/**
 * Streams a claim's screenshot to the reviewing admin.
 *
 * Screenshots are stored as private S3 objects because they show someone's
 * banking app. The object is fetched here, server-side, with the app's own
 * AWS credentials and never reaches a browser directly — the same arrangement
 * as note files, for the same reason.
 */
export const streamScreenshot = async (req, res) => {
  let claim;

  // Everything that can fail with a status code happens before the first byte
  // goes out; after that res.status() is a silent no-op.
  try {
    claim = await PaymentService.getClaim(req.params.id);
    if (!claim.screenshot_url) throw new AppError('This claim has no screenshot', 404);
    if (!isStorageConfigured) {
      throw new AppError('File storage is not configured on this server', 503);
    }
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }

  let object;
  try {
    // screenshot_url holds the S3 key, not a URL — see the note in
    // payment.service.js's submitClaim.
    object = await getObjectBuffer(claim.screenshot_url);
  } catch (err) {
    console.error(`Fetching screenshot for claim ${claim.id} failed:`, err.message);
    return res.status(502).json({ message: 'Could not fetch the screenshot' });
  }

  res.set({
    'Content-Type': object.contentType || 'image/jpeg',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
  });

  res.end(object.buffer);
};
